import { pool } from "../src/db";
import { redis } from "../src/redis";

export const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:8083";
export const TEST_EVENT = "evt-test";
export const TEST_SEATS = ["T1-1", "T1-2", "T1-3", "T1-4", "T1-5"];

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

// Deja el evento de prueba limpio: 5 asientos T1-1 a T1-5, todos AVAILABLE.
export async function resetTestEvent(): Promise<void> {
  await cleanRedis();
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
  await pool.query("DELETE FROM seats WHERE event_id = $1", [TEST_EVENT]);
  await pool.query("DELETE FROM events WHERE id = $1", [TEST_EVENT]);
}

// Cierra las conexiones; si no, el proceso de test no termina.
export async function closeConnections(): Promise<void> {
  await redis.quit();
  await pool.end();
}

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