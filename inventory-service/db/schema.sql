CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS seats (
  event_id    TEXT NOT NULL REFERENCES events(id),
  seat_id     TEXT NOT NULL,              -- formato sector-fila-número, ej. A3-12
  sector      TEXT NOT NULL,
  row_num     INTEGER NOT NULL,
  seat_num    INTEGER NOT NULL,
  price       NUMERIC(10, 2) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'AVAILABLE'
              CHECK (status IN ('AVAILABLE', 'SOLD')),
  order_id    TEXT,
  PRIMARY KEY (event_id, seat_id)
);

-- Para que el consumidor ignore mensajes repetidos (entrega at-least-once)
CREATE TABLE IF NOT EXISTS processed_messages (
  message_id    TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox: eventos que deben publicarse en RabbitMQ.
CREATE TABLE IF NOT EXISTS outbox (
  id              BIGSERIAL PRIMARY KEY,
  message_id      UUID NOT NULL UNIQUE,
  type            TEXT NOT NULL,
  data            JSONB NOT NULL,
  correlation_id  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inventory_outbox_pending
  ON outbox (id)
  WHERE published_at IS NULL;