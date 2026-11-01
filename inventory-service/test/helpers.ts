import { randomUUID } from "node:crypto";
import amqp from "amqplib";
import { config } from "../src/config";
import { pool } from "../src/db";
import { redis } from "../src/redis";

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:8083";
export const TEST_EVENT = "evt-test";
export const TEST_SEATS = ["T1-1", "T1-2", "T1-3", "T1-4", "T1-5"];
const EXCHANGE = "ticketing.events";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Falla con un mensaje claro si el servicio no está corriendo.
export async function assertServiceUp(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`/health respondió ${res.status}`);
  } catch (err) {
    throw new Error(
      `El servicio no responde en ${BASE_URL}. ¿Está corriendo npm run dev y los contenedores? (${(err as Error).message})`,
    );
  }
}

// Borra de Redis todo lo que haya dejado el evento de prueba (asientos y holds).
async function cleanRedis(): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `seat:${TEST_EVENT}:*`, "COUNT", 100);
    cursor = next;
    for (const key of keys) {
      const holdId = await redis.get(key);
      if (holdId) {
        await redis.del(`hold:${holdId}`);
        await redis.zrem("holds:expiry", holdId);
      }
      await redis.del(key);
    }
  } while (cursor !== "0");
}

// Los mensajes de prueba usan messageId "test-<uuid>"; los borramos para no ensuciar la tabla.
async function cleanProcessedMessages(): Promise<void> {
  await pool.query("DELETE FROM processed_messages WHERE message_id LIKE 'test-%'");
}

// Deja el evento de prueba limpio: 5 asientos T1-1 a T1-5, todos AVAILABLE.
export async function resetTestEvent(): Promise<void> {
  await cleanRedis();
  await cleanProcessedMessages();
  await pool.query("DELETE FROM seats WHERE event_id = $1", [TEST_EVENT]);
  await pool.query("DELETE FROM events WHERE id = $1", [TEST_EVENT]);
  await pool.query(
    "INSERT INTO events (id, name, starts_at) VALUES ($1, 'Evento de prueba', now() + interval '30 days')",
    [TEST_EVENT],
  );
  await pool.query(
    `INSERT INTO seats (event_id, seat_id, sector, row_num, seat_num, price)
     SELECT $1::text, 'T1-' || n::text, 'T', 1, n, 100 FROM generate_series(1, 5) AS n`,
    [TEST_EVENT],
  );
}

// Borra el evento de prueba por completo.
export async function dropTestEvent(): Promise<void> {
  await cleanRedis();
  await cleanProcessedMessages();
  await pool.query("DELETE FROM seats WHERE event_id = $1", [TEST_EVENT]);
  await pool.query("DELETE FROM events WHERE id = $1", [TEST_EVENT]);
}

// ---------- HTTP ----------

export interface HttpResult {
  status: number;
  body: any;
}

export async function postHold(userId: string, seatIds: string[]): Promise<HttpResult> {
  const res = await fetch(`${BASE_URL}/api/v1/holds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify({ eventId: TEST_EVENT, seatIds }),
  });
  return { status: res.status, body: await res.json() };
}

// ---------- RabbitMQ ----------

type Conn = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmCh = Awaited<ReturnType<Conn["createConfirmChannel"]>>;

let conn: Conn | null = null;
let pubCh: ConfirmCh | null = null;

async function getConn(): Promise<Conn> {
  if (!conn) conn = await amqp.connect(config.brokerUrl);
  return conn;
}

async function getPublisher(): Promise<ConfirmCh> {
  if (!pubCh) {
    pubCh = await (await getConn()).createConfirmChannel();
    await pubCh.assertExchange(EXCHANGE, "topic", { durable: true });
  }
  return pubCh;
}

export interface PaymentSucceededOpts {
  messageId: string;
  orderId: string;
  holdId: string;
  seatIds: string[];
}

// Publica un payment.succeeded real (sobre estándar del contrato) para el evento de prueba.
export async function publishPaymentSucceeded(o: PaymentSucceededOpts): Promise<void> {
  const ch = await getPublisher();
  const envelope = {
    messageId: o.messageId,
    type: "payment.succeeded",
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: randomUUID(),
    data: { orderId: o.orderId, holdId: o.holdId, eventId: TEST_EVENT, seatIds: o.seatIds },
  };
  await new Promise<void>((resolve, reject) => {
    ch.publish(
      EXCHANGE,
      "payment.succeeded",
      Buffer.from(JSON.stringify(envelope)),
      { persistent: true, contentType: "application/json" },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

// Cola propia (exclusiva, se borra sola) enlazada a sale.rejected.
// Hay que crearla ANTES de publicar: si no, RabbitMQ descarta el mensaje.
export async function startSaleRejectedListener() {
  const ch = await (await getConn()).createChannel();
  await ch.assertExchange(EXCHANGE, "topic", { durable: true });
  const { queue } = await ch.assertQueue("", { exclusive: true, autoDelete: true });
  await ch.bindQueue(queue, EXCHANGE, "sale.rejected");
  const received: any[] = [];
  await ch.consume(queue, (msg) => {
    if (!msg) return;
    received.push(JSON.parse(msg.content.toString("utf8")));
    ch.ack(msg);
  });
  return {
    // Solo los del evento de prueba (por si hay otros tests o servicios publicando).
    rejected: () => received.filter((m) => m.data?.eventId === TEST_EVENT),
    close: async () => {
      await ch.close().catch(() => {});
    },
  };
}

// ---------- Esperas y consultas ----------

// Repite la condición cada 100 ms hasta que se cumpla; si no, falla con un mensaje claro.
export async function waitFor(cond: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await sleep(100);
  }
  throw new Error(`Timeout esperando: ${what} (${timeoutMs} ms). ¿Está corriendo el servicio con sus consumidores?`);
}

export async function countProcessed(messageId: string): Promise<number> {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM processed_messages WHERE message_id = $1", [
    messageId,
  ]);
  return rows[0].n as number;
}

export async function getSeat(seatId: string): Promise<{ status: string; order_id: string | null }> {
  const { rows } = await pool.query("SELECT status, order_id FROM seats WHERE event_id = $1 AND seat_id = $2", [
    TEST_EVENT,
    seatId,
  ]);
  return rows[0];
}

// Cierra las conexiones; si no, el proceso de test no termina.
export async function closeConnections(): Promise<void> {
  await pubCh?.close().catch(() => {});
  await conn?.close().catch(() => {});
  await redis.quit();
  await pool.end();
}