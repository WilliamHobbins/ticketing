import { ConsumeMessage } from "amqplib";
import { pool } from "./db";
import { InvalidMessage, startQueueConsumer } from "./messaging";

const MAX_SEATS_PER_SECTOR = 5000;

interface Sector {
  name: string;
  rows: number;
  seatsPerRow: number;
  price: number;
}

interface EventCreated {
  messageId: string;
  type: string;
  data: { eventId: string; name: string; date: string; sectors: Sector[] };
}

const isPosInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

function parseMessage(msg: ConsumeMessage): EventCreated {
  let body: any;
  try {
    body = JSON.parse(msg.content.toString("utf8"));
  } catch {
    throw new InvalidMessage("JSON inválido");
  }
  if (typeof body?.messageId !== "string" || body.messageId === "") {
    throw new InvalidMessage("falta messageId");
  }
  if (body.type !== "event.created") throw new InvalidMessage("type inesperado");

  const d = body.data;
  if (typeof d?.eventId !== "string" || !/^[\w-]{1,64}$/.test(d.eventId)) {
    throw new InvalidMessage("eventId inválido");
  }
  if (typeof d.name !== "string" || d.name === "") throw new InvalidMessage("name inválido");
  if (typeof d.date !== "string" || Number.isNaN(Date.parse(d.date))) {
    throw new InvalidMessage("date inválida");
  }
  if (!Array.isArray(d.sectors) || d.sectors.length === 0) throw new InvalidMessage("sectors inválido");
  for (const s of d.sectors) {
    if (typeof s?.name !== "string" || s.name === "") throw new InvalidMessage("sector sin nombre");
    if (!isPosInt(s.rows) || !isPosInt(s.seatsPerRow) || s.rows * s.seatsPerRow > MAX_SEATS_PER_SECTOR) {
      throw new InvalidMessage(`rows/seatsPerRow inválidos en el sector ${s.name}`);
    }
    if (typeof s.price !== "number" || s.price < 0) throw new InvalidMessage("price inválido");
  }
  return body as EventCreated;
}

// Devuelve "created" o "duplicate". Si algo falla, el ROLLBACK deshace todo.
async function processEvent(m: EventCreated): Promise<"created" | "duplicate"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Idempotencia: si el messageId ya estaba, no insertó nada y salimos.
    const seen = await client.query(
      "INSERT INTO processed_messages (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [m.messageId, m.type],
    );
    if (seen.rowCount === 0) {
      await client.query("ROLLBACK");
      return "duplicate";
    }

    const { eventId, name, date, sectors } = m.data;
    await client.query(
      "INSERT INTO events (id, name, starts_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [eventId, name, date],
    );

    // Un INSERT por sector; generate_series arma todas las filas y números en Postgres.
    for (const s of sectors) {
      await client.query(
        `INSERT INTO seats (event_id, seat_id, sector, row_num, seat_num, price)
         SELECT $1::text, $2::text || r::text || '-' || n::text, $2::text, r, n, $3::numeric
         FROM generate_series(1, $4::int) AS r, generate_series(1, $5::int) AS n
         ON CONFLICT DO NOTHING`,
        [eventId, s.name, s.price, s.rows, s.seatsPerRow],
      );
    }

    await client.query("COMMIT");
    return "created";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function startConsumer(): Promise<void> {
  return startQueueConsumer({
    queue: "inventory.event-created",
    routingKey: "event.created",
    handler: async (msg) => processEvent(parseMessage(msg)),
  });
}