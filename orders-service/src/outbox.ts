import type { PoolClient } from 'pg';
import { withTransaction } from './db';
import { logger } from './logger';
import { publishEvent } from './messaging';

// Guarda un evento para publicarlo (se llama DENTRO de la transacción del cambio).
export async function enqueueEvent(c: PoolClient, type: string, data: unknown, correlationId: string): Promise<void> {
  await c.query('INSERT INTO outbox (type, data, correlation_id) VALUES ($1, $2, $3)', [
    type,
    JSON.stringify(data),
    correlationId,
  ]);
}

let running = false;

// Publica los eventos pendientes. Usa el message_id guardado, así un reintento
// republica el MISMO messageId y los consumidores lo descartan.
export async function flushOutbox(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await withTransaction(async (c) => {
      const { rows } = await c.query(
        `SELECT id, message_id, type, data, correlation_id FROM outbox
         WHERE published_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`,
      );
      for (const r of rows) {
        await publishEvent(r.type, r.data, r.correlation_id, r.message_id);
        await c.query('UPDATE outbox SET published_at = now() WHERE id = $1', [r.id]);
      }
    });
  } catch (err) {
    logger.error({ err }, 'Falló la publicación de eventos pendientes (outbox)');
  } finally {
    running = false;
  }
}

export function startOutboxWorker(intervalMs = 1000): void {
  const timer = setInterval(() => void flushOutbox(), intervalMs);
  timer.unref();
  logger.info({ intervalMs }, 'Worker de outbox iniciado');
}
