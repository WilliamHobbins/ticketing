import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'orders_' });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Cantidad de requests HTTP',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latencia de requests HTTP en segundos',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Métricas de negocio (se incrementan cuando se implemente la lógica).
export const ordersCreatedTotal = new client.Counter({
  name: 'orders_created_total',
  help: 'Pedidos creados',
  registers: [register],
});

export const paymentsTotal = new client.Counter({
  name: 'payments_total',
  help: 'Pagos procesados por resultado (success, failed, duplicate)',
  labelNames: ['result'],
  registers: [register],
});

export const messagesProcessedTotal = new client.Counter({
  name: 'messages_processed_total',
  help: 'Mensajes de RabbitMQ procesados por tipo y resultado',
  labelNames: ['type', 'result'],
  registers: [register],
});
