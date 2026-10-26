import { logger } from './logger';
import { messagesProcessedTotal } from './metrics';
import { EventEnvelope, subscribe } from './messaging';

// Eventos que consume orders-service:
//  - hold.expired  (inventory) -> marcar el pedido EXPIRED
//  - sale.rejected (inventory) -> marcar el pedido REFUNDED (devolución simulada)
//  - ticket.issued (notifier)  -> guardar las entradas en orders_db
// TODO (próximo paso): lógica real + descarte de messageId ya procesados (processed_messages).
async function handle(envelope: EventEnvelope): Promise<void> {
  logger.info(
    { correlationId: envelope.correlationId, type: envelope.type, messageId: envelope.messageId },
    'Evento recibido (sin lógica todavía)',
  );
  messagesProcessedTotal.inc({ type: envelope.type, result: 'ignored' });
}

export async function registerConsumers(): Promise<void> {
  await subscribe('orders.events', ['hold.expired', 'sale.rejected', 'ticket.issued'], handle);
}
