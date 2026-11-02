import client from 'prom-client';

client.collectDefaultMetrics();

export const messagesProcessedTotal = new client.Counter({
  name: 'notifier_messages_processed_total',
  help: 'Mensajes procesados por tipo y resultado',
  labelNames: ['type', 'result'],
});
export const ticketsIssuedTotal = new client.Counter({
  name: 'notifier_tickets_issued_total',
  help: 'Entradas emitidas',
});
export const emailsSentTotal = new client.Counter({
  name: 'notifier_emails_sent_total',
  help: 'Emails simulados enviados',
  labelNames: ['kind'],
});
export const register = client.register;
