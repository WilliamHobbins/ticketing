import express from 'express';
import { config } from './config';
import { registerConsumers } from './consumers';
import { dbOk, initSchema, pool } from './db';
import { logger } from './logger';
import { closeBroker, connectBroker, isBrokerConnected } from './messaging';
import { register } from './metrics';

async function main(): Promise<void> {
  await initSchema();
  await connectBroker();
  await registerConsumers();

  const app = express();
  app.get('/health', async (_req, res) => {
    const checks = { database: await dbOk(), broker: isBrokerConnected() };
    const ok = checks.database && checks.broker;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', service: 'notifier-worker', checks });
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, 'notifier-worker escuchando'));

  const shutdown = async () => {
    logger.info('Apagando notifier-worker');
    server.close();
    await closeBroker();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'No se pudo iniciar notifier-worker');
  process.exit(1);
});
