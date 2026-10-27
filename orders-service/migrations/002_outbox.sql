-- Los ids de evento los define catalog/inventory: no asumimos que sean UUID.
ALTER TABLE orders ALTER COLUMN event_id TYPE text;

-- Outbox: el evento se guarda en la misma transacción que el cambio del pedido
-- y un worker lo publica a RabbitMQ después. Así nunca queda "pedido PAID sin evento".
CREATE TABLE outbox (
  id              bigserial PRIMARY KEY,
  message_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  data            jsonb NOT NULL,
  correlation_id  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);
CREATE INDEX idx_outbox_pending ON outbox (id) WHERE published_at IS NULL;
