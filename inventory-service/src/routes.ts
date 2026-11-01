import { Request, Router } from "express";
import { ApiError } from "./errors";
import { createHold, extendHold, getHold, releaseHold } from "./holds";
import { listSeats } from "./seats";
import { captureBase } from "./metrics";

export const holdsRouter = Router();

holdsRouter.use(captureBase);

const MAX_SEATS_PER_HOLD = 10;
// Solo letras, números, "_" y "-": evita caracteres raros al armar las claves de Redis.
const ID_PATTERN = /^[\w-]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (message: string) => new ApiError(400, "INVALID_REQUEST", message);

function requireUserId(req: Request): string {
  const userId = req.header("X-User-Id");
  if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Falta el header X-User-Id");
  return userId;
}

function holdIdParam(req: Request): string {
  const holdId = String(req.params.holdId);
  if (!UUID_PATTERN.test(holdId)) throw invalid("holdId inválido");
  return holdId;
}

function parseCreateBody(body: unknown): { eventId: string; seatIds: string[] } {
  const { eventId, seatIds } = (body ?? {}) as Record<string, unknown>;
  if (typeof eventId !== "string" || !ID_PATTERN.test(eventId)) throw invalid("eventId inválido");
  if (!Array.isArray(seatIds) || seatIds.length === 0 || seatIds.length > MAX_SEATS_PER_HOLD) {
    throw invalid(`seatIds debe ser una lista de 1 a ${MAX_SEATS_PER_HOLD} asientos`);
  }
  if (!seatIds.every((s) => typeof s === "string" && ID_PATTERN.test(s))) {
    throw invalid("seatIds contiene un valor inválido");
  }
  if (new Set(seatIds).size !== seatIds.length) throw invalid("seatIds tiene asientos repetidos");
  return { eventId, seatIds: seatIds as string[] };
}

holdsRouter.post("/", async (req, res) => {
  const userId = requireUserId(req);
  const { eventId, seatIds } = parseCreateBody(req.body);
  res.status(201).json(await createHold(userId, eventId, seatIds));
});

holdsRouter.get("/:holdId", async (req, res) => {
  res.json(await getHold(holdIdParam(req)));
});

holdsRouter.delete("/:holdId", async (req, res) => {
  const userId = requireUserId(req);
  await releaseHold(holdIdParam(req), userId);
  res.status(204).end();
});

holdsRouter.post("/:holdId/extend", async (req, res) => {
  res.json(await extendHold(holdIdParam(req)));
});

export const eventsRouter = Router();

eventsRouter.use(captureBase);

eventsRouter.get("/:eventId/seats", async (req, res) => {
  const eventId = String(req.params.eventId);
  if (!ID_PATTERN.test(eventId)) throw invalid("eventId inválido");
  res.json(await listSeats(eventId));
});