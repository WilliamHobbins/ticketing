import { pool } from "./db";
import { ApiError } from "./errors";
import { seatKey } from "./holds";
import { redis } from "./redis";

// Postgres sabe qué asientos existen y cuáles están SOLD; Redis sabe cuáles están HELD.
// Si un asiento está SOLD en Postgres, eso manda sobre lo que diga Redis.
export async function listSeats(eventId: string) {
  const { rows } = await pool.query(
    `SELECT seat_id, sector, row_num, seat_num, price, status
     FROM seats
     WHERE event_id = $1
     ORDER BY sector, row_num, seat_num`,
    [eventId],
  );

  if (rows.length === 0) {
    const ev = await pool.query("SELECT 1 FROM events WHERE id = $1", [eventId]);
    if (ev.rowCount === 0) throw new ApiError(404, "EVENT_NOT_FOUND", "El evento no existe");
    return [];
  }

  // Una sola consulta a Redis por todas las claves, en vez de una por asiento.
  const holders = await redis.mget(rows.map((r) => seatKey(eventId, r.seat_id as string)));

  return rows.map((r, i) => ({
    seatId: r.seat_id as string,
    sector: r.sector as string,
    row: r.row_num as number,
    number: r.seat_num as number,
    price: Number(r.price),
    status: r.status === "SOLD" ? "SOLD" : holders[i] ? "HELD" : "AVAILABLE",
  }));
}