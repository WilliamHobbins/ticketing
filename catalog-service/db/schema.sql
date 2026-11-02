-- Esquema del catálogo. Idempotente (IF NOT EXISTS): catalog-service lo ejecuta en cada arranque.
-- Base de datos: ticketing_catalog

CREATE SCHEMA IF NOT EXISTS catalog;

-- Sedes (teatros, salas, estadios)
CREATE TABLE IF NOT EXISTS catalog.venues (
                                              id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    city        text NOT NULL,
    address     text,
    created_at  timestamptz NOT NULL DEFAULT now()
    );

-- Sectores de una sede. Los asientos se generan como rows x seats_per_row.
-- price_factor multiplica el precio base del evento (ej. 1.5 = platea, 0.6 = paraíso).
CREATE TABLE IF NOT EXISTS catalog.sectors (
                                               id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id       uuid NOT NULL REFERENCES catalog.venues(id) ON DELETE CASCADE,
    name           text NOT NULL,
    rows           int  NOT NULL CHECK (rows BETWEEN 1 AND 26),          -- filas A..Z
    seats_per_row  int  NOT NULL CHECK (seats_per_row BETWEEN 1 AND 60),
    price_factor   numeric(4,2) NOT NULL DEFAULT 1 CHECK (price_factor > 0)
    );
CREATE INDEX IF NOT EXISTS sectors_venue_idx ON catalog.sectors (venue_id);

-- Asientos físicos de cada sector (fila + número)
CREATE TABLE IF NOT EXISTS catalog.seats (
                                             id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sector_id  uuid NOT NULL REFERENCES catalog.sectors(id) ON DELETE CASCADE,
    row_label  text NOT NULL,
    number     int  NOT NULL,
    UNIQUE (sector_id, row_label, number)
    );

-- Eventos. No se puede borrar una sede que tenga eventos (sin ON DELETE CASCADE).
CREATE TABLE IF NOT EXISTS catalog.events (
                                              id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id    uuid NOT NULL REFERENCES catalog.venues(id),
    title       text NOT NULL,
    description text,
    category    text NOT NULL DEFAULT 'General',
    starts_at   timestamptz NOT NULL,
    base_price  numeric(10,2) NOT NULL CHECK (base_price >= 0),
    created_at  timestamptz NOT NULL DEFAULT now()
    );
CREATE INDEX IF NOT EXISTS events_starts_at_idx ON catalog.events (starts_at);
CREATE INDEX IF NOT EXISTS events_venue_idx     ON catalog.events (venue_id);

-- Estado de asientos por evento. SOLO PARA DEMO: pobla el plano del front.
-- La fuente de verdad de disponibilidad y reservas es el servicio de inventario.
CREATE TABLE IF NOT EXISTS catalog.event_seat_status (
                                                         event_id  uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
    seat_id   uuid NOT NULL REFERENCES catalog.seats(id)  ON DELETE CASCADE,
    status    text NOT NULL,
    PRIMARY KEY (event_id, seat_id)
    );