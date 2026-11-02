import { z } from 'zod';
import { config } from './config';
import { AppError } from './errors';

// Cliente HTTP de inventory-service (rutas /api/v1/holds).
const holdSchema = z.object({
  userId: z.string(),
  eventId: z.string(),
  seatIds: z.array(z.string()),
  total: z.coerce.number(),
  expiresAt: z.string(),
});
export type Hold = z.infer<typeof holdSchema>;

const TIMEOUT_MS = 3000;

async function call(method: 'GET' | 'POST', path: string, userId: string, correlationId: string): Promise<unknown> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(`${config.INVENTORY_URL}/api/v1/holds${path}`, {
      method,
      headers: { 'X-User-Id': userId, 'X-Correlation-Id': correlationId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AppError(502, 'INVENTORY_UNAVAILABLE', 'No se pudo contactar al servicio de inventario');
  }
  if (res.status === 404) throw new AppError(404, 'HOLD_NOT_FOUND', 'La reserva no existe');
  if (res.status === 410) throw new AppError(410, 'HOLD_EXPIRED', 'La reserva venció');
  if (!res.ok) throw new AppError(502, 'INVENTORY_ERROR', `Inventario respondió ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new AppError(502, 'INVENTORY_BAD_RESPONSE', 'Respuesta inválida de inventario');
  }
}

export async function getHold(holdId: string, userId: string, correlationId: string): Promise<Hold> {
  const body = await call('GET', `/${holdId}`, userId, correlationId);
  const parsed = holdSchema.safeParse(body);
  if (!parsed.success) throw new AppError(502, 'INVENTORY_BAD_RESPONSE', 'Respuesta inválida de inventario');
  return parsed.data;
}

export async function extendHold(holdId: string, userId: string, correlationId: string): Promise<void> {
  await call('POST', `/${holdId}/extend`, userId, correlationId);
}
