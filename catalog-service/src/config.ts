import 'dotenv/config';
export const config = {
  port: Number(process.env.PORT ?? process.env.CATALOG_PORT ?? 3002),
  env: process.env.NODE_ENV ?? 'development',
  databaseUrl:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? 'postgres'}:${process.env.POSTGRES_PASSWORD ?? ''}@${process.env.POSTGRES_HOST ?? 'postgres'}:5432/${process.env.POSTGRES_DB ?? 'postgres'}`,
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  cacheTtl: Number(process.env.CATALOG_CACHE_TTL ?? 60),
  seed: process.env.CATALOG_SEED !== 'false',
  // RabbitMQ: catalog publica event.created para que inventory cree los asientos.
  brokerUrl: process.env.BROKER_URL ?? process.env.RABBITMQ_URL ?? 'amqp://guest:guest@rabbitmq:5672',
  // Cada cuántos segundos se republican los eventos (0 = solo al arrancar). Es seguro: inventory descarta repetidos.
  republishSeconds: Number(process.env.CATALOG_REPUBLISH_SECONDS ?? 60),
};
export const isProd = config.env === 'production';