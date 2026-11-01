import { randomUUID } from "node:crypto";
import { config } from "./config";
import { EXPIRY_INDEX, holdKey } from "./holds";
import { deterministicUuid, publishEvent } from "./publisher";
import { redis } from "./redis";
import { holdExpiredPublishErrorsTotal, holdsExpiredTotal } from "./metrics";

const LEASE_MS = 30_000; // tiempo que tiene un barrido para publicar antes de que otro reintente
const BATCH = 100;

// Atómico: toma los holds vencidos y les corre el score hacia adelante (lease).
// KEYS: [EXPIRY_INDEX]   ARGV: nowMs, leaseMs, limit
const CLAIM_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[3])
for _, id in ipairs(due) do
  redis.call('ZADD', KEYS[1], tonumber(ARGV[1]) + tonumber(ARGV[2]), id)
end
return due
`;

async function expireOne(holdId: string): Promise<void> {
  const h = await redis.hgetall(holdKey(holdId));

  if (!h.expiresAt) {
    // No hay datos (se liberó a mano o se perdió): no hay nada que publicar.
    await redis.zrem(EXPIRY_INDEX, holdId);
    console.warn(`Hold ${holdId} sin datos en Redis, se descarta del índice`);
    return;
  }

  const expiresAt = Number(h.expiresAt);
  if (expiresAt > Date.now()) {
    // Se extendió justo antes del barrido: todavía vive. Lo dejamos con su score real.
    await redis.zadd(EXPIRY_INDEX, expiresAt, holdId);
    return;
  }

  await publishEvent(
    "hold.expired",
    {
      holdId,
      eventId: h.eventId,
      seatIds: JSON.parse(h.seatIds) as string[],
      userId: h.userId,
    },
    randomUUID(), // el barrido no nace de un request: correlationId nuevo
    deterministicUuid(`hold.expired:${holdId}`),
  );

  // Recién ahora, con la publicación confirmada, sacamos el hold del índice.
  await redis.zrem(EXPIRY_INDEX, holdId);
  holdsExpiredTotal.inc();
  console.log(`hold.expired publicado: ${holdId}`);
}

async function sweepOnce(): Promise<void> {
  const due = (await redis.eval(
    CLAIM_SCRIPT,
    1,
    EXPIRY_INDEX,
    String(Date.now()),
    String(LEASE_MS),
    String(BATCH),
  )) as string[];

  for (const holdId of due) {
    try {
      await expireOne(holdId);
    } catch (err) {
      // Queda con el lease: en ~30 s vuelve a estar vencido y se reintenta solo.
      holdExpiredPublishErrorsTotal.inc();
      console.error(`No se pudo publicar hold.expired de ${holdId}:`, (err as Error).message);
    }
  }
}

// setTimeout encadenado (y no setInterval): un barrido nunca se solapa con el siguiente.
export function startSweeper(): void {
  const run = async () => {
    try {
      await sweepOnce();
    } catch (err) {
      console.error("Error en el barrido:", (err as Error).message);
    } finally {
      setTimeout(run, config.sweepIntervalSeconds * 1000);
    }
  };
  void run();
  console.log(`Barrido de holds cada ${config.sweepIntervalSeconds} s`);
}