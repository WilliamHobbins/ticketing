import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';
import { AppError } from './errors';
import { logger, Logger } from './logger';
import { httpRequestDuration, httpRequestsTotal } from './metrics';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      log: Logger;
      userId?: string;
      userEmail?: string;
    }
  }
}

// Toma X-Correlation-Id (lo asigna el gateway) o genera uno, y lo devuelve en la respuesta.
export const correlation: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-correlation-id');
  const id = incoming && incoming.length <= 100 ? incoming : randomUUID();
  req.correlationId = id;
  req.log = logger.child({ correlationId: id });
  res.setHeader('X-Correlation-Id', id);
  next();
};

// Registra métricas Prometheus y un log por request.
export const requestObserver: RequestHandler = (req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    const seconds = end(labels);
    const noisy = req.path === '/health' || req.path === '/metrics';
    req.log[noisy ? 'debug' : 'info'](
      { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Math.round(seconds * 1000) },
      'request completed',
    );
  });
  next();
};

// El gateway valida el JWT y reenvía X-User-Id / X-User-Email. Este servicio solo debe
// ser accesible desde la red interna de Docker, nunca expuesto directamente.
export const requireUser: RequestHandler = (req, _res, next) => {
  const userId = req.header('x-user-id');
  if (!userId) {
    next(new AppError(401, 'UNAUTHORIZED', 'Falta el usuario autenticado'));
    return;
  }
  req.userId = userId;
  req.userEmail = req.header('x-user-email') ?? undefined;
  next();
};
