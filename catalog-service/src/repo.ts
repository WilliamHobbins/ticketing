import { pool, tx, generateSeats } from './db';
import { cached, invalidate } from './cache';

type Q = Record<string, any>;
const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0] ?? null;

// ---------- Sedes ----------
const VENUE = `id, name, city, address, created_at AS "createdAt"`;
export const listVenues = () => cached('venues', async () => (await pool.query(`SELECT ${VENUE} FROM catalog.venues ORDER BY name`)).rows);
export const getVenue = (id: string) => cached(`venue:${id}`, () => one(`SELECT ${VENUE} FROM catalog.venues WHERE id=$1`, [id]));
export async function createVenue(d: Q) {
  const r = await one(`INSERT INTO catalog.venues(name,city,address) VALUES ($1,$2,$3) RETURNING ${VENUE}`, [d.name, d.city, d.address ?? null]);
  await invalidate(); return r;
}
export async function updateVenue(id: string, d: Q) {
  const r = await one(`UPDATE catalog.venues SET name=COALESCE($2,name), city=COALESCE($3,city), address=COALESCE($4,address) WHERE id=$1 RETURNING ${VENUE}`, [id, d.name ?? null, d.city ?? null, d.address ?? null]);
  await invalidate(); return r;
}
export async function deleteVenue(id: string) {
  const r = await one('DELETE FROM catalog.venues WHERE id=$1 RETURNING id', [id]);
  await invalidate(); return !!r;
}

// ---------- Sectores (los asientos se generan: filas x asientos por fila) ----------
const SECTOR = `id, venue_id AS "venueId", name, rows, seats_per_row AS "seatsPerRow", price_factor::float AS "priceFactor"`;
export const listSectors = (venueId: string) =>
  cached(`sectors:${venueId}`, async () => (await pool.query(`SELECT ${SECTOR} FROM catalog.sectors WHERE venue_id=$1 ORDER BY price_factor DESC, name`, [venueId])).rows);
export const getSector = (id: string) => cached(`sector:${id}`, () => one(`SELECT ${SECTOR} FROM catalog.sectors WHERE id=$1`, [id]));
export async function createSector(venueId: string, d: Q) {
  const r = await tx(async (c) => {
    const s = (await c.query(`INSERT INTO catalog.sectors(venue_id,name,rows,seats_per_row,price_factor) VALUES ($1,$2,$3,$4,$5) RETURNING ${SECTOR}`,
      [venueId, d.name, d.rows, d.seatsPerRow, d.priceFactor ?? 1])).rows[0];
    await generateSeats(c, s.id, s.rows, s.seatsPerRow);
    return s;
  });
  await invalidate(); return r;
}
export async function updateSector(id: string, d: Q) {
  const r = await tx(async (c) => {
    const cur = (await c.query(`SELECT ${SECTOR} FROM catalog.sectors WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!cur) return null;
    const rows = d.rows ?? cur.rows, per = d.seatsPerRow ?? cur.seatsPerRow;
    const s = (await c.query(`UPDATE catalog.sectors SET name=$2, rows=$3, seats_per_row=$4, price_factor=$5 WHERE id=$1 RETURNING ${SECTOR}`,
      [id, d.name ?? cur.name, rows, per, d.priceFactor ?? cur.priceFactor])).rows[0];
    if (rows !== cur.rows || per !== cur.seatsPerRow) {
      await c.query('DELETE FROM catalog.seats WHERE sector_id=$1', [id]);
      await generateSeats(c, id, rows, per);
    }
    return s;
  });
  await invalidate(); return r;
}
export async function deleteSector(id: string) {
  const r = await one('DELETE FROM catalog.sectors WHERE id=$1 RETURNING id', [id]);
  await invalidate(); return !!r;
}

// ---------- Eventos ----------
const EVENT = `SELECT e.id, e.title, e.description, e.category, e.starts_at AS "startsAt", e.base_price::float AS "basePrice",
  e.venue_id AS "venueId", v.name AS "venueName", v.city AS "venueCity",
  (SELECT min(e.base_price * s.price_factor) FROM catalog.sectors s WHERE s.venue_id = e.venue_id)::float AS "minPrice"
  FROM catalog.events e JOIN catalog.venues v ON v.id = e.venue_id`;
const fetchEvent = (id: string) => one(`${EVENT} WHERE e.id=$1`, [id]);

export const listEvents = (f: { q?: string | null; city?: string | null; limit?: number | null } = {}) =>
  cached(`events:${JSON.stringify(f)}`, async () => {
    const p: unknown[] = [], w: string[] = [];
    if (f.q) { p.push(`%${f.q}%`); w.push(`e.title ILIKE $${p.length}`); }
    if (f.city) { p.push(f.city); w.push(`v.city ILIKE $${p.length}`); }
    p.push(Math.min(f.limit ?? 50, 200));
    return (await pool.query(`${EVENT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY e.starts_at LIMIT $${p.length}`, p)).rows;
  });
export const getEvent = (id: string) => cached(`event:${id}`, () => fetchEvent(id));
export async function createEvent(d: Q) {
  const { id } = await one(`INSERT INTO catalog.events(venue_id,title,description,category,starts_at,base_price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [d.venueId, d.title, d.description ?? null, d.category ?? 'General', d.startsAt, d.basePrice]);
  await invalidate(); return fetchEvent(id);
}
export async function updateEvent(id: string, d: Q) {
  const r = await one(`UPDATE catalog.events SET venue_id=COALESCE($2,venue_id), title=COALESCE($3,title), description=COALESCE($4,description),
    category=COALESCE($5,category), starts_at=COALESCE($6,starts_at), base_price=COALESCE($7,base_price) WHERE id=$1 RETURNING id`,
    [id, d.venueId ?? null, d.title ?? null, d.description ?? null, d.category ?? null, d.startsAt ?? null, d.basePrice ?? null]);
  await invalidate(); return r ? fetchEvent(id) : null;
}
export async function deleteEvent(id: string) {
  const r = await one('DELETE FROM catalog.events WHERE id=$1 RETURNING id', [id]);
  await invalidate(); return !!r;
}

// Mapa de asientos del evento. TTL corto: el estado real vendrá del servicio de inventario.
export const eventSeats = (eventId: string) =>
  cached(`seats:${eventId}`, async () => (await pool.query(
    `SELECT s.id, sec.id AS "sectorId", sec.name AS sector, s.row_label AS "row", s.number,
            round(e.base_price * sec.price_factor, 2)::float AS price, COALESCE(st.status, 'available') AS status
     FROM catalog.events e
     JOIN catalog.sectors sec ON sec.venue_id = e.venue_id
     JOIN catalog.seats s ON s.sector_id = sec.id
     LEFT JOIN catalog.event_seat_status st ON st.event_id = e.id AND st.seat_id = s.id
     WHERE e.id = $1 ORDER BY sec.price_factor DESC, sec.name, s.row_label, s.number`, [eventId])).rows, 10);
