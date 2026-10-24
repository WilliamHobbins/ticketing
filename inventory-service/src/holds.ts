import { randomUUID } from "node:crypto";
import { redis } from "./redis";

const HOLD_TTL_SECONDS = Number(process.env.HOLD_TTL_SECONDS ?? 600);

const seatKey = (eventId: string, seatId: string) => `hold:${eventId}:${seatId}`;
const holdKey = (holdId: string) => `holdid:${holdId}`;

// Intenta tomar el asiento (SET NX EX). Si lo logra, guarda también el índice por holdId.
// Devuelve 1 si creó el hold, 0 si el asiento ya estaba tomado.
const CREATE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[3]) then
  redis.call('SET', KEYS[2], KEYS[1], 'EX', ARGV[3])
  return 1
end
return 0
`;

// Libera el hold solo si el holdId coincide con el dueño actual del asiento.
// Devuelve 1 si lo liberó, 0 si no existía (venció o ya se liberó).
const RELEASE_SCRIPT = `
local seat = redis.call('GET', KEYS[1])
if not seat then return 0 end
if redis.call('GET', seat) == ARGV[1] then
  redis.call('DEL', seat)
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

export interface Hold {
  holdId: string;
  eventId: string;
  seatId: string;
  expiresAt: string; // ISO 8601, UTC
}

export async function createHold(eventId: string, seatId: string): Promise<Hold | null> {
  const holdId = randomUUID();
  const created = await redis.eval(
    CREATE_SCRIPT,
    2,
    seatKey(eventId, seatId),
    holdKey(holdId),
    holdId,
    "",
    String(HOLD_TTL_SECONDS)
  );
  if (created !== 1) return null;

  const expiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000).toISOString();
  return { holdId, eventId, seatId, expiresAt };
}

export async function releaseHold(holdId: string): Promise<boolean> {
  const released = await redis.eval(RELEASE_SCRIPT, 1, holdKey(holdId), holdId);
  return released === 1;
}