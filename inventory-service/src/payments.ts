import { ConsumeMessage } from "amqplib";
import { pool } from "./db";
import { claimSeatsForSale, loadHold, releaseHoldKeys } from "./holds";
import { InvalidMessage, parseEnvelope, startQueueConsumer } from "./messaging";
import { deterministicUuid, publishEvent } from "./publisher";
import {
  holdsReleasedByPaymentTotal,
  salesConfirmedTotal,
  salesRejectedTotal,
} from "./metrics";

const ID = /^[\w-]{1,64}$/;
const isId = (v: unknown): v is string => typeof v === "string" && ID.test(v);

// ---------- payment.succeeded ----------

interface PaymentSucceeded {
  messageId: string;
  correlationId: string;
  data: { orderId: string; holdId: string; eventId: string; seatIds: string[] };
}

function parseSucceeded(msg: ConsumeMessage): PaymentSucceeded {
  const env = parseEnvelope(msg, "payment.succeeded");
  const d = env.data;
  if (!isId(d.orderId)) throw new InvalidMessage("orderId inválido");
  if (!isId(d.holdId)) throw new InvalidMessage("holdId inválido");
  if (!isId(d.eventId)) throw new InvalidMessage("eventId inválido");
  if (
    !Array.isArray(d.seatIds) ||
    d.seatIds.length === 0 ||
    !d.seatIds.every(isId) ||
    new Set(d.seatIds).size !== d.seatIds.length
  ) {
    throw new InvalidMessage("seatIds inválido");
  }
  return {
    messageId: env.messageId,
    correlationId: env.correlationId,
    data: { orderId: d.orderId, holdId: d.holdId, eventId: d.eventId, seatIds: d.seatIds },
  };
}

type SaleResult = { kind: "sold" } | { kind: "rejected"; reason: string } | { kind: "duplicate" };

// Una transacción: registra el messageId y vende (o rechaza) los asientos.
// Si hay que rechazar, publica sale.rejected ANTES del COMMIT: si algo falla,
// el mensaje se reintenta y el messageId determinístico evita duplicados.
async function sellInPostgres(m: PaymentSucceeded, takenByOthers: string[]): Promise<SaleResult> {
  const { orderId, holdId, eventId, seatIds } = m.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const seen = await client.query(
      "INSERT INTO processed_messages (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [m.messageId, "payment.succeeded"],
    );
    if (seen.rowCount === 0) {
      await client.query("ROLLBACK");
      return { kind: "duplicate" };
    }

    let reason: string | null = null;
    if (takenByOthers.length > 0) {
      reason = "SEAT_TAKEN"; // otro hold tiene hoy esos asientos
    } else {
      // Bloquea las filas en orden fijo (evita deadlocks entre ventas que comparten asientos).
      const { rows } = await client.query(
        `SELECT seat_id, status, order_id FROM seats
         WHERE event_id = $1 AND seat_id = ANY($2::text[])
         ORDER BY seat_id FOR UPDATE`,
        [eventId, seatIds],
      );
      if (rows.length !== seatIds.length) {
        reason = "SEAT_NOT_FOUND";
      } else if (rows.some((r) => r.status === "SOLD" && r.order_id !== orderId)) {
        reason = "SEAT_ALREADY_SOLD";
      } else {
        // Los que ya estaban SOLD con este mismo orderId quedan como están (idempotente).
        await client.query(
          `UPDATE seats SET status = 'SOLD', order_id = $3
           WHERE event_id = $1 AND seat_id = ANY($2::text[]) AND status = 'AVAILABLE'`,
          [eventId, seatIds, orderId],
        );
      }
    }

    if (reason) {
      await publishEvent(
        "sale.rejected",
        { orderId, holdId, eventId, seatIds, reason },
        m.correlationId,
        deterministicUuid(`sale.rejected:${orderId}`),
      );
    }

    await client.query("COMMIT");
    return reason ? { kind: "rejected", reason } : { kind: "sold" };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function handleSucceeded(m: PaymentSucceeded): Promise<string> {
  const { orderId, holdId, eventId, seatIds } = m.data;

  const takenByOthers = await claimSeatsForSale(holdId, eventId, seatIds); // Redis
  const result = await sellInPostgres(m, takenByOthers); // Postgres
  await releaseHoldKeys(holdId, eventId, seatIds); // Redis (también si fue duplicado)

  if (result.kind === "sold") {
    salesConfirmedTotal.inc();
    return `vendido (pedido ${orderId})`;
  }
  if (result.kind === "rejected") {
    salesRejectedTotal.inc({ reason: result.reason });
    console.warn(`Venta rechazada, pedido ${orderId}: ${result.reason}`);
    return `rechazado ${result.reason}`;
  }
  return "duplicate";
}

// ---------- payment.failed ----------

interface PaymentFailed {
  messageId: string;
  data: { orderId: string; holdId: string; reason: string };
}

function parseFailed(msg: ConsumeMessage): PaymentFailed {
  const env = parseEnvelope(msg, "payment.failed");
  const d = env.data;
  if (!isId(d.orderId)) throw new InvalidMessage("orderId inválido");
  if (!isId(d.holdId)) throw new InvalidMessage("holdId inválido");
  return {
    messageId: env.messageId,
    data: { orderId: d.orderId, holdId: d.holdId, reason: typeof d.reason === "string" ? d.reason : "" },
  };
}

// Liberar es idempotente, así que primero se libera y recién después se anota el messageId:
// si algo falla en el medio, el reintento simplemente vuelve a liberar.
async function handleFailed(m: PaymentFailed): Promise<string> {
  const seen = await pool.query("SELECT 1 FROM processed_messages WHERE message_id = $1", [m.messageId]);
  if (seen.rowCount) return "duplicate";

  // payment.failed no trae eventId ni seatIds: los leemos del hold en Redis.
  const hold = await loadHold(m.data.holdId);
  let result = "sin hold en Redis, nada que liberar";
  if (hold) {
    await releaseHoldKeys(hold.holdId, hold.eventId, hold.seatIds);
    holdsReleasedByPaymentTotal.inc();
    result = `hold ${hold.holdId} liberado`;
  } else {
    console.warn(`payment.failed: el hold ${m.data.holdId} ya no existe en Redis`);
  }

  await pool.query(
    "INSERT INTO processed_messages (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [m.messageId, "payment.failed"],
  );
  return result;
}

export function startPaymentConsumers(): void {
  void startQueueConsumer({
    queue: "inventory.payment-succeeded",
    routingKey: "payment.succeeded",
    handler: async (msg) => handleSucceeded(parseSucceeded(msg)),
  });
  void startQueueConsumer({
    queue: "inventory.payment-failed",
    routingKey: "payment.failed",
    handler: async (msg) => handleFailed(parseFailed(msg)),
  });
}