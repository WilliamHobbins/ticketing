import { randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { withTransaction } from './db';
import { logger } from './logger';
import { EventEnvelope, publishEvent, subscribe } from './messaging';
import { emailsSentTotal, messagesProcessedTotal, ticketsIssuedTotal } from './metrics';

// Eventos que consume el notifier:
//  - payment.succeeded (orders)    -> genera entradas, publica ticket.issued, simula email
//  - sale.rejected     (inventory) -> anula entradas y simula email de devolución

const paymentSucceededData = z.object({
  orderId: z.string().uuid(),
  userId: z.string(),
  email: z.string(),
  eventId: z.string(),
  seatIds: z.array(z.string()).min(1),
});
const saleRejectedData = z.object({ orderId: z.string().uuid() });

const newCode = () => `TKT-${randomBytes(6).toString('hex').toUpperCase()}`;

async function onPaymentSucceeded(envelope: EventEnvelope): Promise<string> {
  const d = paymentSucceededData.parse(envelope.data);
  const log = logger.child({ correlationId: envelope.correlationId, orderId: d.orderId });

  const { first, tickets } = await withTransaction(async (c) => {
    const ins = await c.query(
      'INSERT INTO processed_messages (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id',
      [envelope.messageId, envelope.type],
    );
    const isFirst = (ins.rowCount ?? 0) > 0;
    if (isFirst) {
      for (const seatId of d.seatIds) {
        await c.query(
          `INSERT INTO tickets (id, order_id, user_id, event_id, seat_id, code)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (order_id, seat_id) DO NOTHING`,
          [randomUUID(), d.orderId, d.userId, d.eventId, seatId, newCode()],
        );
      }
    }
    const rows = await c.query(
      'SELECT id, seat_id, code FROM tickets WHERE order_id = $1 ORDER BY seat_id',
      [d.orderId],
    );
    return {
      first: isFirst,
      tickets: rows.rows.map((r) => ({ ticketId: r.id as string, seatId: r.seat_id as string, code: r.code as string })),
    };
  });

  // Se publica SIEMPRE (también si el mensaje llegó repetido): si antes falló la publicación,
  // el reintento la completa. Orders ignora entradas repetidas (ON CONFLICT DO NOTHING).
  await publishEvent('ticket.issued', { orderId: d.orderId, tickets }, envelope.correlationId);

  if (first) {
    ticketsIssuedTotal.inc(tickets.length);
    emailsSentTotal.inc({ kind: 'ticket' });
    log.info(
      { to: d.email, codes: tickets.map((t) => t.code) },
      `EMAIL SIMULADO: entradas confirmadas para ${d.email}`,
    );
    return 'processed';
  }
  return 'duplicate';
}

async function onSaleRejected(envelope: EventEnvelope): Promise<string> {
  const d = saleRejectedData.parse(envelope.data);
  const log = logger.child({ correlationId: envelope.correlationId, orderId: d.orderId });
  const first = await withTransaction(async (c) => {
    const ins = await c.query(
      'INSERT INTO processed_messages (message_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING message_id',
      [envelope.messageId, envelope.type],
    );
    if (!ins.rowCount) return false;
    await c.query(`UPDATE tickets SET status = 'VOIDED' WHERE order_id = $1`, [d.orderId]);
    return true;
  });
  if (!first) return 'duplicate';
  emailsSentTotal.inc({ kind: 'refund' });
  log.info('EMAIL SIMULADO: la compra fue rechazada, se devuelve el pago');
  return 'processed';
}

async function handle(envelope: EventEnvelope): Promise<void> {
  let result = 'ignored';
  if (envelope.type === 'payment.succeeded') result = await onPaymentSucceeded(envelope);
  else if (envelope.type === 'sale.rejected') result = await onSaleRejected(envelope);
  messagesProcessedTotal.inc({ type: envelope.type, result });
  logger.info(
    { type: envelope.type, messageId: envelope.messageId, correlationId: envelope.correlationId, result },
    'Evento procesado',
  );
}

export async function registerConsumers(): Promise<void> {
  await subscribe('notifier.events', ['payment.succeeded', 'sale.rejected'], handle);
}
