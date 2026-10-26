import { createApp } from './app';
import { config } from './config';
import { closeDb, runMigrations } from './db';
import { logger } from './logger';
import { registerConsumers } from './consumers';
import { closeBroker, connectBroker } from './messaging';

async function main(): Promise<void> {
  await runMigrations();
  await connectBroker();

  await registerConsumers();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'orders-service escuchando');
  });

  // Apagado limpio ante SIGTERM (factor 9 de 12-Factor: descartabilidad).
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Apagando orders-service');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(async () => {
      await closeBroker();
      await closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'No se pudo iniciar orders-service');
  process.exit(1);
});
