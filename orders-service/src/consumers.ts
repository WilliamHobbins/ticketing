import type { PoolClient } from 'pg';
import { z } from 'zod';
import { withTransaction } from './db';
import { Logger, logger } from './logger';
import { EventEnvelope, subscribe } from './messaging';
import { messagesProcessedTotal } from './metrics';
import { startOutboxWorker } from './outbox';

// Eventos que consume orders-service:
//  - hold.expired  (inventory) -> pedido EXPIRED
//  - sale.rejected (inventory) -> pedido REFUNDED (devolución simulada) y entradas VOIDED
//  - ticket.issued (notifier)  -> guardar las entradas
// Todos son idempotentes: el messageId se registra en processed_messages en la MISMA transacción.

const holdExpiredData = z.object({ holdId: z.string().uuid() });
const saleRejectedData = z.object({ orderId: z.string().uuid() });
const ticketIssuedData = z.object({
  orderId: z.string().uuid(),
  tickets: z.array(z.object({ ticketId: z.string().uuid(), seatId: z.string(), code: z.string() })),
});

type Outcome = 'processed' | 'ignored' | 'duplicate';

async function onHoldExpired(c: PoolClient, data: unknown): Promise<Outcome> {
  const { holdId } = holdExpiredData.parse(data);
  await c.query(
    `UPDATE orders SET status = 'EXPIRED', updated_at = now() WHERE hold_id = $1 AND status = 'PENDING_PAYMENT'`,
    [holdId],
  );
  return 'processed';
}

async function onSaleRejected(c: PoolClient, data: unknown, log: Logger): Promise<Outcome> {
  const { orderId } = saleRejectedData.parse(data);
  const r = await c.query(
    `UPDATE orders SET status = 'REFUNDED', updated_at = now() WHERE id = $1 AND status = 'PAID'`,
    [orderId],
  );
  if (!r.rowCount) log.warn({ orderId }, 'sale.rejected para un pedido que no está PAID');
  await c.query(`UPDATE tickets SET status = 'VOIDED' WHERE order_id = $1`, [orderId]);
  return 'processed';
}

async function onTicketIssued(c: PoolClient, data: unknown, log: Logger): Promise<Outcome> {
  const { orderId, tickets } = ticketIssuedData.parse(data);
  const o = await c.query('SELECT status FROM orders WHERE id = $1 FOR SHARE', [orderId]);
  if (!o.rowCount) {
    log.warn({ orderId }, 'ticket.issued para un pedido inexistente, se ignora');
    return 'ignored';
  }
  // Si sale.rejected llegó ANTES que ticket.issued, las entradas nacen anuladas.
  const status = o.rows[0].status === 'REFUNDED' ? 'VOIDED' : 'VALID';
  for (const t of tickets) {
    await c.query(
      `INSERT INTO tickets (id, order_id, seat_id, code, status) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [t.ticketId, orderId, t.seatId, t.code, status],
    );
  }
  return 'processed';
}

async function handle(envelope: EventEnvelope): Promise<void> {
  const log = logger.child({
    correlationId: envelope.correlationId,
    type: envelope.type,
    messageId: envelope.messageId,
  });
  const outcome = await withTransaction(async (c): Promise<Outcome> => {
    const first = await c.query(
      'INSERT INTO processed_messages (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id',
      [envelope.messageId, envelope.type],
    );
    if (!first.rowCount) return 'duplicate';
    switch (envelope.type) {
      case 'hold.expired':
        return onHoldExpired(c, envelope.data);
      case 'sale.rejected':
        return onSaleRejected(c, envelope.data, log);
      case 'ticket.issued':
        return onTicketIssued(c, envelope.data, log);
      default:
        return 'ignored';
    }
  });
  log.info({ outcome }, 'Evento procesado');
  messagesProcessedTotal.inc({ type: envelope.type, result: outcome });
}

export async function registerConsumers(): Promise<void> {
  await subscribe('orders.events', ['hold.expired', 'sale.rejected', 'ticket.issued'], handle);
  startOutboxWorker(); // publica los eventos guardados en la tabla outbox
}
