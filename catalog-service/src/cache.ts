import Redis from 'ioredis';
import { config } from './config';
import { log } from './logger';
import { cacheCounter } from './metrics';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (t) => Math.min(t * 200, 5000),
});
redis.on('error', (e) => log.warn({ err: e.message }, 'redis error'));

// Cache-aside con "versión": al escribir se incrementa la versión y las claves viejas dejan de usarse (expiran por TTL).
// Si Redis cae, se lee directo de PostgreSQL (degradación elegante).
export async function cached<T>(key: string, load: () => Promise<T>, ttl = config.cacheTtl): Promise<T> {
  let k: string | null = null;
  try {
    k = `catalog:${(await redis.get('catalog:ver')) ?? '0'}:${key}`;
    const hit = await redis.get(k);
    if (hit !== null) { cacheCounter.inc({ result: 'hit' }); return JSON.parse(hit) as T; }
    cacheCounter.inc({ result: 'miss' });
  } catch {
    cacheCounter.inc({ result: 'error' });
    k = null;
  }
  const value = await load();
  if (k) redis.set(k, JSON.stringify(value), 'EX', ttl).catch(() => undefined);
  return value;
}
export const invalidate = () => redis.incr('catalog:ver').catch(() => undefined);
