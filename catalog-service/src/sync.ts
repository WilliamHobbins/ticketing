import { pool } from './db';
import { config } from './config';
import { log } from './logger';
import { publish, Envelope } from './publisher';

// Inventory arma el id del asiento como {sector}{fila}-{número} y valida los ids con /^[\w-]{1,64}$/.
// Por eso el nombre del sector se publica sin tildes, espacios ni símbolos ("Paraíso" -> "Paraiso").
const slug = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'S';

// Arma el mensaje event.created con el formato que espera consumer.ts de inventory.
// Devuelve null si el evento no existe o su sede no tiene sectores (inventory lo rechazaría).
export async function buildEventCreated(eventId: string): Promise<Envelope | null> {
    const { rows } = await pool.query(
        `SELECT e.title, e.starts_at, e.base_price::float AS base,
            sec.name, sec.rows, sec.seats_per_row AS per, sec.price_factor::float AS factor
     FROM catalog.events e
     JOIN catalog.sectors sec ON sec.venue_id = e.venue_id
     WHERE e.id = $1
     ORDER BY sec.price_factor DESC, sec.name`,
        [eventId],
    );
    if (rows.length === 0) return null;

    // Si dos sectores quedan con el mismo nombre tras limpiarlos, inventory pisaría asientos: se desambigua.
    const used = new Set<string>();
    const sectors = rows.map((r) => {
        let name = slug(r.name);
        for (let i = 2; used.has(name); i++) name = `${slug(r.name)}_${i}`;
        used.add(name);
        return {
            name,
            rows: r.rows as number,
            seatsPerRow: r.per as number,
            price: Math.round(r.base * r.factor * 100) / 100, // mismo precio que muestra eventSeats()
        };
    });

    return {
        // messageId fijo por evento: republicar es seguro, inventory descarta los repetidos.
        messageId: `event.created:${eventId}`,
        type: 'event.created',
        timestamp: new Date().toISOString(),
        data: { eventId, name: rows[0].title, date: new Date(rows[0].starts_at).toISOString(), sectors },
    };
}

type Result = 'ok' | 'skipped' | 'error';

export async function publishEvent(eventId: string): Promise<Result> {
    try {
        const msg = await buildEventCreated(eventId);
        if (!msg) { log.warn({ eventId }, 'event.created omitido: el evento no existe o su sede no tiene sectores'); return 'skipped'; }
        await publish('event.created', msg);
        return 'ok';
    } catch (err) {
        log.warn({ err: (err as Error).message, eventId }, 'no se pudo publicar event.created; se reintenta en el próximo barrido');
        return 'error';
    }
}

// Publica todos los eventos del catálogo (el seed los inserta sin publicar).
// Si RabbitMQ no responde, corta en el primer error en vez de fallar evento por evento.
export async function republishAll(): Promise<void> {
    const { rows } = await pool.query('SELECT id FROM catalog.events');
    let ok = 0;
    for (const r of rows) {
        const res = await publishEvent(r.id);
        if (res === 'error') break;
        if (res === 'ok') ok++;
    }
    log.info({ total: rows.length, publicados: ok }, 'event.created republicados');
}

export function startRepublisher(): NodeJS.Timeout | undefined {
    republishAll().catch((e) => log.warn({ err: (e as Error).message }, 'republishAll falló'));
    if (config.republishSeconds <= 0) return undefined;
    const t = setInterval(
        () => republishAll().catch((e) => log.warn({ err: (e as Error).message }, 'republishAll falló')),
        config.republishSeconds * 1000,
    );
    t.unref();
    return t;
}