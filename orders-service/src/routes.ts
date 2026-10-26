import { Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { AppError } from './errors';
import { createOrder, getOrder, getTickets, listOrders, payOrder, User } from './orders';

export const ordersRouter = Router();

// Express 4 no captura errores de funciones async: este wrapper los pasa al errorHandler.
const ah =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new AppError(400, 'INVALID_REQUEST', msg);
  }
  return r.data;
}

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

function currentUser(req: Request): User {
  if (!req.userId || !isUuid(req.userId)) throw new AppError(401, 'UNAUTHORIZED', 'X-User-Id inválido');
  return { id: req.userId, email: req.userEmail };
}

function orderIdParam(req: Request): string {
  const id = String(req.params.orderId);
  if (!isUuid(id)) throw new AppError(404, 'ORDER_NOT_FOUND', 'El pedido no existe');
  return id;
}

const createBody = z.object({ holdId: z.string().uuid() });
const payBody = z.object({
  method: z.literal('mock').default('mock'),
  simulate: z.enum(['success', 'fail']).default('success'),
});

ordersRouter.post(
  '/',
  ah(async (req, res) => {
    const user = currentUser(req);
    const { holdId } = parse(createBody, req.body);
    const { order, created } = await createOrder(user, holdId, req.correlationId);
    res.status(created ? 201 : 200).json(order);
  }),
);

ordersRouter.post(
  '/:orderId/pay',
  ah(async (req, res) => {
    const user = currentUser(req);
    const orderId = orderIdParam(req);
    const key = req.header('idempotency-key');
    if (!key || key.length > 200) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta el header Idempotency-Key');
    }
    const input = parse(payBody, req.body ?? {});
    const result = await payOrder(user, orderId, key, input, req.correlationId);
    res.status(result.statusCode).json(result.body);
  }),
);

ordersRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listOrders(currentUser(req).id));
  }),
);

ordersRouter.get(
  '/:orderId',
  ah(async (req, res) => {
    res.json(await getOrder(currentUser(req).id, orderIdParam(req)));
  }),
);

ordersRouter.get(
  '/:orderId/tickets',
  ah(async (req, res) => {
    res.json(await getTickets(currentUser(req).id, orderIdParam(req)));
  }),
);
