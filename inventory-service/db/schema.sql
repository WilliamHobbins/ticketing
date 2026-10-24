CREATE TABLE events (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL
);

CREATE TABLE seats (
  id          UUID PRIMARY KEY,
  event_id    UUID NOT NULL REFERENCES events(id),
  label       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'AVAILABLE'
              CHECK (status IN ('AVAILABLE', 'SOLD')),
  order_id    UUID,
  UNIQUE (event_id, label)
);