
import type { PoolClient } from "pg";
import { pool } from "./db";
import { publishEvent } from "./publisher";
import { errorMessage, logger } from "./logger";

// Guarda el evento dentro de la misma transacción del cambio de negocio.
export async function enqueueEvent(
  client: PoolClient,
  type: string,
  data: Record<string, unknown>,
  correlationId: string,
  messageId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox (message_id, type, data, correlation_id)
     VALUES ($1, $2, $3, $4)`,
    [messageId, type, JSON.stringify(data), correlationId],
  );
}

let activeFlush: Promise<void> | null = null;
let timer: NodeJS.Timeout | undefined;
let stopped = false;

// Publica los eventos pendientes y marca los confirmados.
async function flushPending(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, message_id, type, data, correlation_id
       FROM outbox
       WHERE published_at IS NULL
       ORDER BY id
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
    );

    for (const row of rows) {
      await publishEvent(
        row.type,
        row.data,
        row.correlation_id,
        row.message_id,
      );

      await client.query(
        "UPDATE outbox SET published_at = now() WHERE id = $1",
        [row.id],
      );
    }

    await client.query("COMMIT");

    if (rows.length > 0) {
      logger.info("Eventos Outbox publicados", { count: rows.length });
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Evita que dos ejecuciones publiquen simultáneamente los mismos pendientes.
export function flushOutbox(): Promise<void> {
  if (activeFlush) return activeFlush;

  activeFlush = flushPending().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
}

// Worker periódico: intenta publicar los pendientes cada segundo.
export function startOutboxWorker(): void {
  stopped = false;

  const run = async () => {
    try {
      await flushOutbox();
    } catch (err) {
      logger.error("Error publicando Outbox", {
        error: errorMessage(err),
      });
    } finally {
      if (!stopped) {
        timer = setTimeout(run, 1000);
      }
    }
  };

  void run();
  logger.info("Worker Outbox iniciado", { intervalMs: 1000 });
}

// Detiene el worker y espera a que termine una publicación en curso.
export async function stopOutboxWorker(): Promise<void> {
  stopped = true;

  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }

  await activeFlush?.catch(() => {});
}
