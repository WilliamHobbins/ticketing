import express, { NextFunction, Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from './config';
import { log } from './logger';
import { migrate, seed, waitForDb, pool } from './db';
import { redis } from './cache';
import { router, health } from './routes';
import { yoga } from './graphql';
import { registry, httpDuration } from './metrics';

const app = express();
app.disable('x-powered-by');
app.use(pinoHttp({
  logger: log,
  genReqId: (req, res) => {
    const id = (req.headers['x-correlation-id'] as string) || randomUUID();
    res.setHeader('X-Correlation-Id', id);
    return id;
  },
}));
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: req.route ? req.baseUrl + req.route.path : 'other', status: res.statusCode }));
  next();
});

app.get('/health', health);
app.get('/metrics', async (_req, res) => { res.type(registry.contentType).send(await registry.metrics()); }); // solo red interna
app.use(yoga.graphqlEndpoint, yoga as any);   // antes de express.json(): Yoga lee su propio body
app.use(express.json({ limit: '100kb' }));
app.use('/api/v1/catalog', router);
app.use((_req, res) => { res.status(404).json({ error: 'Ruta inexistente' }); });
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Datos inválidos', details: err.issues });
  if (err?.code === '23503') return res.status(409).json({ error: 'Referencia inexistente o recurso con dependencias' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  req.log.error({ err }, 'error no controlado');
  res.status(500).json({ error: 'Error interno' });
});

async function main() {
  await waitForDb();
  await migrate();
  if (config.seed) await seed();
  const server = app.listen(config.port, () => log.info({ port: config.port, env: config.env }, 'catalog-service listo'));
  const stop = () => server.close(async () => { await pool.end(); redis.disconnect(); process.exit(0); });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch((e) => { log.fatal(e); process.exit(1); });
