import { randomUUID } from "node:crypto";
import { config } from "./config";
import { ApiError } from "./errors";
import { redis } from "./redis";
import { pool } from "./db";



// Claves en Redis:
//   seat:{eventId}:{seatId} -> holdId, con TTL exacto (esto es lo que "bloquea" el asiento)
//   hold:{holdId}           -> hash con los datos del hold; vive más que el hold (GRACE)
//                              para que el barrido del paso 4 pueda publicar hold.expired
//   holds:expiry            -> sorted set (score = vencimiento en ms) que usará ese barrido
const GRACE_SECONDS = 3600;
export const EXPIRY_INDEX = "holds:expiry";
export const holdKey = (holdId: string) => `hold:${holdId}`;
export const seatKey = (eventId: string, seatId: string) => `seat:${eventId}:${seatId}`;

// Los scripts Lua corren de forma atómica en Redis: nadie se mete a mitad.
// Eso nos da el "todo o nada" para varios asientos con la misma garantía de SET NX EX.

// KEYS: [holdKey, EXPIRY_INDEX, ...seatKeys]
// ARGV: holdId, ttlSeconds, userId, eventId, seatIdsJson, total, expiresAtMs, hashTtlSeconds
// Devuelve [] si reservó todo, o los índices (base 1) de los asientos en conflicto.
const CREATE_SCRIPT = `
local conflicts = {}
for i = 3, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    table.insert(conflicts, i - 2)
  end
end
if #conflicts > 0 then return conflicts end
for i = 3, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ARGV[2])
end
redis.call('HSET', KEYS[1], 'userId', ARGV[3], 'eventId', ARGV[4],
  'seatIds', ARGV[5], 'total', ARGV[6], 'expiresAt', ARGV[7])
redis.call('EXPIRE', KEYS[1], ARGV[8])
redis.call('ZADD', KEYS[2], ARGV[7], ARGV[1])
return {}
`;

// Solo borra los asientos que siguen siendo de ESTE hold (si el hold venció y otro
// usuario tomó el asiento, no hay que pisarle la reserva).
// KEYS: [holdKey, EXPIRY_INDEX, ...seatKeys]   ARGV: holdId
const RELEASE_SCRIPT = `
for i = 3, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
  end
end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return 1
`;

// KEYS: [holdKey, EXPIRY_INDEX, ...seatKeys]
// ARGV: holdId, nowMs, extendMs, graceMs
// Devuelve el nuevo vencimiento en ms, o -1 si el hold ya no está vigente.
const EXTEND_SCRIPT = `
local current = tonumber(redis.call('HGET', KEYS[1], 'expiresAt'))
if not current or current <= tonumber(ARGV[2]) then return -1 end
for i = 3, #KEYS do
  if redis.call('GET', KEYS[i]) ~= ARGV[1] then return -1 end
end
local newExp = math.max(current, tonumber(ARGV[2]) + tonumber(ARGV[3]))
for i = 3, #KEYS do
  redis.call('PEXPIREAT', KEYS[i], newExp)
end
redis.call('HSET', KEYS[1], 'expiresAt', newExp)
redis.call('PEXPIREAT', KEYS[1], newExp + tonumber(ARGV[4]))
redis.call('ZADD', KEYS[2], newExp, ARGV[1])
return newExp
`;

interface StoredHold {
  holdId: string;
  userId: string;
  eventId: string;
  seatIds: string[];
  total: number;
  expiresAtMs: number;
}

// Consulta Postgres: los asientos tienen que existir y no estar vendidos.
// Devuelve el total (suma de los precios).
async function checkSeatsAndPrice(eventId: string, seatIds: string[]): Promise<number> {
  const { rows } = await pool.query(
    "SELECT seat_id, price, status FROM seats WHERE event_id = $1 AND seat_id = ANY($2::text[])",
    [eventId, seatIds],
  );

  const found = new Set(rows.map((r) => r.seat_id as string));
  const missing = seatIds.filter((s) => !found.has(s));
  if (missing.length > 0) {
    throw new ApiError(404, "SEAT_NOT_FOUND", "Uno o más asientos no existen en este evento", {
      seatIds: missing,
    });
  }

  const sold = rows.filter((r) => r.status === "SOLD").map((r) => r.seat_id as string);
  if (sold.length > 0) {
    throw new ApiError(409, "SEAT_UNAVAILABLE", "Uno o más asientos no están disponibles", {
      seatIds: sold,
    });
  }

  const total = rows.reduce((sum, r) => sum + Number(r.price), 0);
  return Math.round(total * 100) / 100; // evita restos de decimales (0.1 + 0.2)
}

async function loadHold(holdId: string): Promise<StoredHold | null> {
  const h = await redis.hgetall(holdKey(holdId));
  if (!h.expiresAt) return null;
  return {
    holdId,
    userId: h.userId,
    eventId: h.eventId,
    seatIds: JSON.parse(h.seatIds) as string[],
    total: Number(h.total),
    expiresAtMs: Number(h.expiresAt),
  };
}

function holdExpired(): ApiError {
  return new ApiError(410, "HOLD_EXPIRED", "La reserva venció o no existe");
}

export async function createHold(userId: string, eventId: string, seatIds: string[]) {
  const holdId = randomUUID();
  const expiresAtMs = Date.now() + config.holdTtlSeconds * 1000;
  const total = await checkSeatsAndPrice(eventId, seatIds);

  const keys = [holdKey(holdId), EXPIRY_INDEX, ...seatIds.map((s) => seatKey(eventId, s))];
  const conflicts = (await redis.eval(
    CREATE_SCRIPT,
    keys.length,
    ...keys,
    holdId,
    String(config.holdTtlSeconds),
    userId,
    eventId,
    JSON.stringify(seatIds),
    String(total),
    String(expiresAtMs),
    String(config.holdTtlSeconds + GRACE_SECONDS),
  )) as number[];

  if (conflicts.length > 0) {
    throw new ApiError(409, "SEAT_UNAVAILABLE", "Uno o más asientos no están disponibles", {
      seatIds: conflicts.map((i) => seatIds[i - 1]),
    });
  }
  return { holdId, eventId, seatIds, expiresAt: new Date(expiresAtMs).toISOString() };
}

export async function getHold(holdId: string) {
  const hold = await loadHold(holdId);
  if (!hold || hold.expiresAtMs <= Date.now()) throw holdExpired();
  return {
    holdId: hold.holdId,
    userId: hold.userId,
    eventId: hold.eventId,
    seatIds: hold.seatIds,
    total: hold.total,
    expiresAt: new Date(hold.expiresAtMs).toISOString(),
    status: "ACTIVE",
  };
}

export async function releaseHold(holdId: string, userId: string): Promise<void> {
  const hold = await loadHold(holdId);
  if (!hold) return; // idempotente: liberar algo que no existe es un éxito
  if (hold.userId !== userId) {
    throw new ApiError(403, "FORBIDDEN", "La reserva pertenece a otro usuario");
  }
  // Si ya venció, los asientos ya se liberaron solos por TTL; dejamos el registro
  // para que el barrido del paso 4 publique hold.expired.
  if (hold.expiresAtMs <= Date.now()) return;

  const keys = [holdKey(holdId), EXPIRY_INDEX, ...hold.seatIds.map((s) => seatKey(hold.eventId, s))];
  await redis.eval(RELEASE_SCRIPT, keys.length, ...keys, holdId);
}

export async function extendHold(holdId: string) {
  const hold = await loadHold(holdId);
  if (!hold || hold.expiresAtMs <= Date.now()) throw holdExpired();

  const keys = [holdKey(holdId), EXPIRY_INDEX, ...hold.seatIds.map((s) => seatKey(hold.eventId, s))];
  const newExpiry = (await redis.eval(
    EXTEND_SCRIPT,
    keys.length,
    ...keys,
    holdId,
    String(Date.now()),
    String(config.holdExtendSeconds * 1000),
    String(GRACE_SECONDS * 1000),
  )) as number;

  if (newExpiry < 0) throw holdExpired();
  return { holdId, expiresAt: new Date(newExpiry).toISOString() };
}