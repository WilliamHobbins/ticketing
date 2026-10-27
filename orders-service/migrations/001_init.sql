-- Pedidos. Un pedido por hold (hold_id UNIQUE).
CREATE TABLE orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL,
  user_email  text,
  hold_id     uuid NOT NULL UNIQUE,
  event_id    uuid NOT NULL,
  seat_ids    text[] NOT NULL,
  total       numeric(12,2) NOT NULL,
  status      text NOT NULL DEFAULT 'PENDING_PAYMENT'
              CHECK (status IN ('PENDING_PAYMENT','PAID','PAYMENT_FAILED','EXPIRED','REFUNDED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_user ON orders (user_id, created_at DESC);

-- Pagos simulados (uno por intento de cobro).
CREATE TABLE payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  amount      numeric(12,2) NOT NULL,
  method      text NOT NULL DEFAULT 'mock',
  status      text NOT NULL CHECK (status IN ('SUCCEEDED','FAILED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Idempotencia del pago: misma clave del mismo usuario = misma respuesta.
-- status_code y response quedan en NULL mientras el pago está en curso.
CREATE TABLE idempotency_keys (
  user_id       uuid NOT NULL,
  key           text NOT NULL,
  order_id      uuid NOT NULL REFERENCES orders(id),
  request_hash  text NOT NULL,
  status_code   int,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Entradas emitidas (llegan por el evento ticket.issued).
CREATE TABLE tickets (
  id          uuid PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id),
  seat_id     text NOT NULL,
  code        text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID','VOIDED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, seat_id)
);

-- Mensajes de RabbitMQ ya procesados (consumidor idempotente, at-least-once).
CREATE TABLE processed_messages (
  message_id    uuid PRIMARY KEY,
  type          text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now()
);
