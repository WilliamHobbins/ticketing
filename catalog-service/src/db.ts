import { Pool, PoolClient } from 'pg';
import { config } from './config';
import { log } from './logger';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

export async function waitForDb(tries = 30) {
  for (let i = 1; ; i++) {
    try { await pool.query('SELECT 1'); return; }
    catch (e) { if (i >= tries) throw e; log.warn(`esperando PostgreSQL (${i}/${tries})`); await new Promise((r) => setTimeout(r, 1000)); }
  }
}

export async function migrate() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS catalog;
    CREATE TABLE IF NOT EXISTS catalog.venues (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, city text NOT NULL, address text,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS catalog.sectors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id uuid NOT NULL REFERENCES catalog.venues(id) ON DELETE CASCADE,
      name text NOT NULL, rows int NOT NULL CHECK (rows BETWEEN 1 AND 26),
      seats_per_row int NOT NULL CHECK (seats_per_row BETWEEN 1 AND 60),
      price_factor numeric(4,2) NOT NULL DEFAULT 1 CHECK (price_factor > 0));
    CREATE TABLE IF NOT EXISTS catalog.seats (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sector_id uuid NOT NULL REFERENCES catalog.sectors(id) ON DELETE CASCADE,
      row_label text NOT NULL, number int NOT NULL, UNIQUE (sector_id, row_label, number));
    CREATE TABLE IF NOT EXISTS catalog.events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id uuid NOT NULL REFERENCES catalog.venues(id),
      title text NOT NULL, description text, category text NOT NULL DEFAULT 'General',
      starts_at timestamptz NOT NULL, base_price numeric(10,2) NOT NULL CHECK (base_price >= 0),
      created_at timestamptz NOT NULL DEFAULT now());
    -- Estado de asientos por evento. SOLO PARA DEMO: la fuente de verdad será el servicio de inventario/reservas.
    CREATE TABLE IF NOT EXISTS catalog.event_seat_status (
      event_id uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
      seat_id uuid NOT NULL REFERENCES catalog.seats(id) ON DELETE CASCADE,
      status text NOT NULL, PRIMARY KEY (event_id, seat_id));
    CREATE INDEX IF NOT EXISTS events_starts_at_idx ON catalog.events (starts_at);
  `);
}

export async function generateSeats(c: PoolClient, sectorId: string, rows: number, perRow: number) {
  await c.query(
    `INSERT INTO catalog.seats(sector_id,row_label,number)
     SELECT $1, chr(64 + r), n FROM generate_series(1,$2::int) r, generate_series(1,$3::int) n`,
    [sectorId, rows, perRow]);
}

export async function seed() {
  if ((await pool.query('SELECT 1 FROM catalog.venues LIMIT 1')).rows.length) return;
  const venues = [
    { name: 'Teatro Solís', city: 'Montevideo', address: 'Buenos Aires 678',
      sectors: [['Platea', 8, 12, 1.5], ['Palcos', 4, 10, 1.2], ['Paraíso', 5, 14, 0.6]] },
    { name: 'Sala Zitarrosa', city: 'Montevideo', address: '18 de Julio 1012',
      sectors: [['Platea', 9, 14, 1.3], ['Balcón', 4, 12, 1]] },
    { name: 'Teatro Larrañaga', city: 'Salto', address: 'Uruguay 619',
      sectors: [['Platea', 6, 12, 1.4], ['Galería', 4, 14, 0.7]] },
  ] as const;
  const events: [number, string, string, string, number, number][] = [
    [0, 'Tango sinfónico', 'Orquesta de cámara y bandoneón en un repertorio de tango clásico.', 'Concierto', 10, 1400],
    [1, 'Candombe fusión en vivo', 'Tambores, bajo y vientos en una noche de candombe contemporáneo.', 'Concierto', 15, 900],
    [0, 'Hamlet', 'Versión en español de la tragedia de Shakespeare, con elenco estable.', 'Teatro', 21, 1100],
    [1, 'Noche de stand-up', 'Cinco humoristas, un solo escenario.', 'Humor', 8, 700],
    [2, 'Orquesta juvenil: Beethoven', 'Quinta y Séptima sinfonías a cargo de la orquesta juvenil del litoral.', 'Concierto', 30, 600],
    [0, 'El cascanueces', 'Ballet clásico de fin de año con cuerpo de baile completo.', 'Danza', 45, 1600],
  ];
  await tx(async (c) => {
    const ids: string[] = [];
    for (const v of venues) {
      const { rows } = await c.query('INSERT INTO catalog.venues(name, city, address) VALUES ($1,$2,$3) RETURNING id', [v.name, v.city, v.address]);
      ids.push(rows[0].id);
      for (const [name, r, n, f] of v.sectors) {
        const s = await c.query('INSERT INTO catalog.sectors(venue_id,name,rows,seats_per_row,price_factor) VALUES ($1,$2,$3,$4,$5) RETURNING id', [rows[0].id, name, r, n, f]);
        await generateSeats(c, s.rows[0].id, r, n);
      }
    }
    for (const [vi, title, desc, cat, days, price] of events)
      await c.query(
        `INSERT INTO catalog.events(venue_id,title,description,category,starts_at,base_price)
         VALUES ($1,$2,$3,$4, date_trunc('day', now()) + ($5::int * interval '1 day') + interval '21 hours', $6)`,
        [ids[vi], title, desc, cat, days, price]);
    // ~15% de asientos "vendidos" de forma determinística, para que el mapa de la demo no se vea vacío
    await c.query(`INSERT INTO catalog.event_seat_status(event_id, seat_id, status)
      SELECT e.id, s.id, 'sold' FROM catalog.events e
      JOIN catalog.sectors sec ON sec.venue_id = e.venue_id JOIN catalog.seats s ON s.sector_id = sec.id
      WHERE abs(hashtext(e.id::text || s.id::text)) % 100 < 15`);
  });
  log.info('datos de ejemplo cargados');
}
