import express from 'express';
import { checkDb } from './db';
import { errorHandler, notFoundHandler } from './errors';
import { correlation, requestObserver } from './middleware';
import { isBrokerConnected } from './messaging';
import { register } from './metrics';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(correlation);
  app.use(requestObserver);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    const checks = { database: false, broker: isBrokerConnected() };
    try {
      await checkDb();
      checks.database = true;
    } catch {
      checks.database = false;
    }
    const ok = checks.database && checks.broker;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable', service: 'orders-service', checks });
  });

  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  // Próximo paso: app.use('/api/v1/orders', requireUser, ordersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
