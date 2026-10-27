export const config = {
  port: Number(process.env.CATALOG_PORT ?? 3002),
  env: process.env.NODE_ENV ?? 'development',
  databaseUrl:
    process.env.DATABASE_URL ??
    `postgres://${process.env.POSTGRES_USER ?? 'postgres'}:${process.env.POSTGRES_PASSWORD ?? ''}@${process.env.POSTGRES_HOST ?? 'postgres'}:5432/${process.env.POSTGRES_DB ?? 'postgres'}`,
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  cacheTtl: Number(process.env.CATALOG_CACHE_TTL ?? 60),
  seed: process.env.CATALOG_SEED !== 'false',
};
export const isProd = config.env === 'production';
