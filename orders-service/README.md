# orders-service (Rol 4)

Pedidos, pago simulado, saga y entradas. Node 20 + TypeScript + Express, PostgreSQL (`ticketing_orders`) y RabbitMQ.

**Estado:** esqueleto. Funcionan `GET /health` y `GET /metrics`, logs JSON, migración de tablas, conexión a RabbitMQ (exchange, cola y DLQ) y la suscripción a `hold.expired`, `sale.rejected` y `ticket.issued` (por ahora solo registra el evento). Los endpoints `/api/v1/orders` se agregan en el próximo paso.

## Correr local (solo para desarrollar)
```bash
cp .env.example .env   # ajustar passwords
npm install
npm run dev
```
Necesita Postgres (con la base `ticketing_orders`) y RabbitMQ levantados. `npm run dev` no lee el `.env` solo: exportá las variables o usá `node --env-file=.env` / el compose.

## Integración con la infra de Willy (hay que tocar 4 lugares)

### 1. `infra/postgres/init-databases.sql`
```sql
CREATE DATABASE ticketing_orders;
```
Ojo: ese script solo corre la primera vez que se crea el volumen. Si Postgres ya estaba levantado:
```bash
docker compose exec postgres psql -U ticketing -d ticketing_users -c "CREATE DATABASE ticketing_orders;"
```
(o `docker compose down -v` si no les importa perder datos).

### 2. `docker-compose.yml` (dentro de `services:`)
```yaml
  orders-service:
    build:
      context: ./orders-service
    environment:
      NODE_ENV: production
      PORT: 3004
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/ticketing_orders
      BROKER_URL: amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672
      INVENTORY_URL: ${INVENTORY_URL:-http://inventory-service:8083}
      EVENTS_EXCHANGE: ticketing.events
      LOG_LEVEL: ${LOG_LEVEL:-info}
    depends_on:
      postgres:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    expose:
      - "3004"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3004/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 15s
    restart: unless-stopped
```
   `INVENTORY_URL` apunta al inventory-service en el puerto 8083, según el contrato.
Si la password de Postgres o RabbitMQ tiene caracteres especiales (`@`, `:`, `/`), hay que codificarlos en la URL.

### 3. Prometheus (`infra/prometheus/prometheus.yml`)
Agregar un job igual al de users-service apuntando a `orders-service:3004` (path `/metrics`) y sumar `orders-service` al `depends_on` de prometheus.

### 4. Gateway (`gateway/nginx.conf`), pedirle a Willy
`/api/v1/orders` -> `orders-service:3004`, con `auth_request` y reenvío de `X-User-Id`, `X-User-Email` y `X-Correlation-Id`.

## Estructura
```
src/
  server.ts      arranque, migraciones, consumidores, apagado limpio (SIGTERM)
  app.ts         Express, /health, /metrics
  config.ts      variables de entorno validadas con zod
  logger.ts      pino: timestamp, level, service, correlationId, message
  metrics.ts     prom-client: HTTP + métricas de negocio
  middleware.ts  correlationId, métricas HTTP, requireUser (X-User-Id)
  errors.ts      error uniforme { error: { code, message } }
  db.ts          pool de pg, transacciones y migraciones
  messaging.ts   RabbitMQ: exchange topic, publishEvent, subscribe (+DLQ)
  consumers.ts   suscripción a hold.expired, sale.rejected, ticket.issued (sin lógica)
migrations/
  001_init.sql   orders, payments, idempotency_keys, tickets, processed_messages
```

## Variables de entorno
`PORT` (3004), `DATABASE_URL`, `BROKER_URL`, `INVENTORY_URL`, `EVENTS_EXCHANGE`, `LOG_LEVEL`, `NODE_ENV`.
