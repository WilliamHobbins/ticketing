import client from 'prom-client';
export const registry = client.register;
client.collectDefaultMetrics();
export const httpDuration = new client.Histogram({
  name: 'catalog_http_request_duration_seconds', help: 'Duración de requests HTTP',
  labelNames: ['method', 'route', 'status'], buckets: [0.01, 0.05, 0.1, 0.3, 1, 3],
});
export const cacheCounter = new client.Counter({
  name: 'catalog_cache_total', help: 'Resultados de caché Redis', labelNames: ['result'],
});
