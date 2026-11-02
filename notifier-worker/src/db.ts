import { Pool, PoolClient } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

export async function initSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id         uuid PRIMARY KEY,
      order_id   uuid NOT NULL,
      user_id    text NOT NULL,
      event_id   text NOT NULL,
      seat_id    text NOT NULL,
      code       text NOT NULL UNIQUE,
      status     text NOT NULL DEFAULT 'VALID',
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (order_id, seat_id)
    );
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id   uuid PRIMARY KEY,
      type         text NOT NULL,
      processed_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function dbOk(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
