# Eventos de orders-service y notifier-worker

Exchange `topic` **`ticketing.events`**. La routing key es el `type` del evento.
Entrega at-least-once: todo consumidor es idempotente (registra el `messageId` en `processed_messages`).
Cada cola tiene su dead-letter queue (exchange `ticketing.events.dlx`, tipo `topic`).

## Sobre común

```json
{
  "messageId": "uuid",
  "type": "payment.succeeded",
  "version": 1,
  "occurredAt": "2026-11-03T19:33:01Z",
  "correlationId": "uuid",
  "data": {}
}
```

## Publica orders-service
Se publican con el patrón **outbox**: el evento se guarda en la tabla `outbox` en la misma transacción que el cambio de estado, y un worker lo envía a RabbitMQ.

### payment.succeeded
Consumen: inventory (marca `SOLD`) y notifier (emite entradas).

| Campo | Tipo |
|---|---|
| orderId | uuid |
| holdId | uuid |
| eventId | string |
| userId | uuid |
| email | string |
| seatIds | string[] |
| amount | number |

### payment.failed
Consume: inventory (libera los asientos).

| Campo | Tipo |
|---|---|
| orderId | uuid |
| holdId | uuid |
| reason | string |

## Consume orders-service

### hold.expired (publica inventory)
Efecto: el pedido `PENDING_PAYMENT` con ese `holdId` pasa a `EXPIRED`.
Campo obligatorio: `holdId` (uuid). Inventory también manda `eventId`, `seatIds` y `userId`, que orders ignora.

### sale.rejected (publica inventory)
Efecto (compensación de la saga): el pedido `PAID` pasa a `REFUNDED` (devolución simulada) y sus entradas a `VOIDED`.
Campo obligatorio: `orderId` (uuid). Inventory agrega `reason`: `SEAT_ALREADY_SOLD`, `SEAT_TAKEN` o `SEAT_NOT_FOUND`.

### ticket.issued (publica notifier)
Efecto: orders guarda las entradas para servirlas en `GET /orders/{orderId}/tickets`.

| Campo | Tipo |
|---|---|
| orderId | uuid |
| tickets | `[{ ticketId: uuid, seatId: string, code: string }]` |

## Consume notifier-worker
Cola `notifier.events`, routing keys `payment.succeeded` y `sale.rejected`.

- **payment.succeeded:** emite una entrada por asiento (`TKT-...`), simula el email (log) y publica `ticket.issued`. Si el pedido ya tenía entradas, no las duplica.
- **sale.rejected:** marca las entradas del pedido como `VOIDED` en `ticketing_tickets`.

## Idempotencia
1. **Por mensaje:** `processed_messages` guarda el `messageId`. Un repetido da `result: duplicate`.
2. **Por pedido:** el notifier no emite entradas dos veces para el mismo `orderId`.
3. **Pago:** `Idempotency-Key` en `POST /orders/{id}/pay`.
