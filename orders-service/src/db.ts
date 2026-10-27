import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { config } from './config';
import { logger } from './logger';

export const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on('error', (err) => {
  logger.error({ err }, 'Error inesperado en el pool de PostgreSQL');
});

export async function checkDb(): Promise<void> {
  await pool.query('SELECT 1');
}

// Ejecuta fn dentro de una transacción: COMMIT si sale bien, ROLLBACK si falla.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Aplica los .sql de /migrations en orden, una sola vez cada uno.
export async function runMigrations(): Promise<void> {
  const dir = path.resolve(__dirname, '../migrations');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    logger.info({ migration: file }, 'Migración aplicada');
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
