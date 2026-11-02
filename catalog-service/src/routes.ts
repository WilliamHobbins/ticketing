import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import * as repo from './repo';
import { pool } from './db';
import { redis } from './cache';

export const router = Router();
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res).catch(next); };
const uuid = (v: unknown) => z.string().uuid().parse(v);
const found = (res: Response, x: unknown) => (x ? res.json(x) : res.status(404).json({ error: 'No encontrado' }));
const gone = (res: Response, ok: boolean) => (ok ? res.status(204).end() : res.status(404).json({ error: 'No encontrado' }));

export const health = async (_req: Request, res: Response) => {
  const db = await pool.query('SELECT 1').then(() => 'up', () => 'down');
  const cache = redis.status === 'ready' ? 'up' : 'down';
  res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db, cache });
};
router.get('/health', wrap(health));

// Lecturas públicas. Escrituras: requieren el header X-User-Id que inyecta el gateway tras validar el JWT.
router.use((req: Request, res: Response, next: NextFunction) =>
  ['GET', 'HEAD'].includes(req.method) || req.header('x-user-id') ? next() : res.status(401).json({ error: 'Autenticación requerida' }));

const venue = z.object({ name: z.string().min(1).max(120), city: z.string().min(1).max(80), address: z.string().max(200).optional() });
const sector = z.object({ name: z.string().min(1).max(60), rows: z.number().int().min(1).max(26),
  seatsPerRow: z.number().int().min(1).max(60), priceFactor: z.number().min(0.1).max(10).optional() });
const event = z.object({ venueId: z.string().uuid(), title: z.string().min(1).max(160), description: z.string().max(2000).optional(),
  category: z.string().max(40).optional(), startsAt: z.coerce.date(), basePrice: z.number().min(0) });

router.get('/venues', wrap(async (_q, res) => res.json(await repo.listVenues())));
router.get('/venues/:id', wrap(async (q, res) => found(res, await repo.getVenue(uuid(q.params.id)))));
router.post('/venues', wrap(async (q, res) => res.status(201).json(await repo.createVenue(venue.parse(q.body)))));
router.put('/venues/:id', wrap(async (q, res) => found(res, await repo.updateVenue(uuid(q.params.id), venue.partial().parse(q.body)))));
router.delete('/venues/:id', wrap(async (q, res) => gone(res, await repo.deleteVenue(uuid(q.params.id)))));

router.get('/venues/:id/sectors', wrap(async (q, res) => {
  const id = uuid(q.params.id);
  return (await repo.getVenue(id)) ? res.json(await repo.listSectors(id)) : res.status(404).json({ error: 'Sede no encontrada' });
}));
router.post('/venues/:id/sectors', wrap(async (q, res) => {
  const id = uuid(q.params.id);
  if (!(await repo.getVenue(id))) return res.status(404).json({ error: 'Sede no encontrada' });
  res.status(201).json(await repo.createSector(id, sector.parse(q.body)));
}));
router.get('/sectors/:id', wrap(async (q, res) => found(res, await repo.getSector(uuid(q.params.id)))));
router.put('/sectors/:id', wrap(async (q, res) => found(res, await repo.updateSector(uuid(q.params.id), sector.partial().parse(q.body)))));
router.delete('/sectors/:id', wrap(async (q, res) => gone(res, await repo.deleteSector(uuid(q.params.id)))));

const filters = z.object({ q: z.string().max(100).optional(), city: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).optional() });
router.get('/events', wrap(async (q, res) => res.json(await repo.listEvents(filters.parse(q.query)))));
router.get('/events/:id', wrap(async (q, res) => found(res, await repo.getEvent(uuid(q.params.id)))));
router.get('/events/:id/seats', wrap(async (q, res) => {
  const id = uuid(q.params.id);
  return (await repo.getEvent(id)) ? res.json(await repo.eventSeats(id)) : res.status(404).json({ error: 'Evento no encontrado' });
}));
router.post('/events', wrap(async (q, res) => res.status(201).json(await repo.createEvent(event.parse(q.body)))));
router.put('/events/:id', wrap(async (q, res) => found(res, await repo.updateEvent(uuid(q.params.id), event.partial().parse(q.body)))));
router.delete('/events/:id', wrap(async (q, res) => gone(res, await repo.deleteEvent(uuid(q.params.id)))));
