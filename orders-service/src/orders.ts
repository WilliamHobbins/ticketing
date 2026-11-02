import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { pool, withTransaction } from './db';
import { AppError } from './errors';
import { extendHold, getHold } from './inventory';
import { ordersCreatedTotal, paymentsTotal } from './metrics';
import { enqueueEvent, flushOutbox } from './outbox';

export interface User {
  id: string;
  email?: string;
}

interface Stored {
  statusCode: number;
  body: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toOrder = (r: any) => ({
  orderId: r.id as string,
  eventId: r.event_id as string,
  holdId: r.hold_id as string,
  status: r.status as string,
  total: Number(r.total),
  seatIds: r.seat_ids as string[],
  createdAt: r.created_at as Date,
  updatedAt: r.updated_at as Date,
});

// ---------- Crear pedido ----------
export async function createOrder(user: User, holdId: string, correlationId: string) {
  const hold = await getHold(holdId, user.id, correlationId);
  if (hold.userId !== user.id) throw new AppError(403, 'HOLD_NOT_OWNED', 'La reserva pertenece a otro usuario');
  if (new Date(hold.expiresAt).getTime() <= Date.now()) throw new AppError(410, 'HOLD_EXPIRED', 'La reserva venció');

  // total y asientos salen SIEMPRE de inventory, nunca del cliente.
  const ins = await pool.query(
    `INSERT INTO orders (user_id, user_email, hold_id, event_id, seat_ids, total)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (hold_id) DO NOTHING RETURNING *`,
    [user.id, user.email ?? null, holdId, hold.eventId, hold.seatIds, hold.total],
  );
  if (ins.rowCount) {
    ordersCreatedTotal.inc();
    return { order: toOrder(ins.rows[0]), created: true };
  }
  // Ya había un pedido para ese hold: lo devolvemos (crear dos veces no duplica).
  const existing = await pool.query('SELECT * FROM orders WHERE hold_id = $1', [holdId]);
  return { order: toOrder(existing.rows[0]), created: false };
}

// ---------- Consultas ----------
export async function listOrders(userId: string) {
  const r = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return r.rows.map(toOrder);
}

export async function getOrder(userId: string, orderId: string) {
  const r = await pool.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId]);
  if (!r.rowCount) throw new AppError(404, 'ORDER_NOT_FOUND', 'El pedido no existe');
  return toOrder(r.rows[0]);
}

export async function getTickets(userId: string, orderId: string) {
  await getOrder(userId, orderId); // 404 si no es del usuario
  const r = await pool.query(
    'SELECT id, seat_id, code, status FROM tickets WHERE order_id = $1 ORDER BY seat_id',
    [orderId],
  );
  return r.rows.map((t) => ({ ticketId: t.id, seatId: t.seat_id, code: t.code, status: t.status }));
}

// ---------- Pago (idempotente) ----------
async function saveResponse(c: PoolClient, userId: string, key: string, statusCode: number, body: unknown) {
  await c.query('UPDATE idempotency_keys SET status_code = $3, response = $4 WHERE user_id = $1 AND key = $2', [
    userId,
    key,
    statusCode,
    JSON.stringify(body),
  ]);
}

export async function payOrder(
  user: User,
  orderId: string,
  key: string,
  input: { method: 'mock'; simulate: 'success' | 'fail' },
  correlationId: string,
): Promise<Stored> {
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ orderId, method: input.method, simulate: input.simulate }))
    .digest('hex');

  // Paso 1 (transacción corta): bloquear el pedido y reservar la clave de idempotencia.
  const start = await withTransaction(async (c) => {
    const o = await c.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [orderId, user.id]);
    if (!o.rowCount) throw new AppError(404, 'ORDER_NOT_FOUND', 'El pedido no existe');

    const ins = await c.query(
      `INSERT INTO idempotency_keys (user_id, key, order_id, request_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
      [user.id, key, orderId, requestHash],
    );
    if (!ins.rowCount) {
      const k = (
        await c.query('SELECT request_hash, status_code, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [
          user.id,
          key,
        ])
      ).rows[0];
      if (k.request_hash !== requestHash) {
        throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Esa Idempotency-Key ya se usó con otra solicitud');
      }
      if (k.status_code === null) throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'El pago ya está en curso');
      return { replay: { statusCode: k.status_code as number, body: k.response as unknown } };
    }
    if (o.rows[0].status !== 'PENDING_PAYMENT') {
      // Al lanzar, se hace ROLLBACK y la clave reservada se descarta.
      throw new AppError(409, 'ORDER_NOT_PENDING', 'El pedido ya no está pendiente de pago');
    }
    return { order: o.rows[0] };
  });

  if (start.replay) {
    paymentsTotal.inc({ result: 'duplicate' });
    return start.replay;
  }
  const order = start.order;

  // Paso 2: extender el hold (evita la carrera entre expiración y pago). Sin locks de DB abiertos.
  try {
    await extendHold(order.hold_id, user.id, correlationId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'HOLD_EXPIRED') {
      const body = { error: { code: 'HOLD_EXPIRED', message: 'La reserva venció antes de pagar' } };
      await withTransaction(async (c) => {
        await c.query(
          `UPDATE orders SET status = 'EXPIRED', updated_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
          [orderId],
        );
        await saveResponse(c, user.id, key, 410, body);
      });
      return { statusCode: 410, body };
    }
    // Inventory caído u otro error: se libera la clave para que el cliente pueda reintentar.
    await pool.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [user.id, key]);
    throw err;
  }

  // Paso 3 (una transacción): pago simulado + estado + evento (outbox) + respuesta guardada.
  const ok = input.simulate === 'success';
  const result = await withTransaction(async (c): Promise<Stored> => {
    const upd = await c.query(
      `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 AND status = 'PENDING_PAYMENT' RETURNING *`,
      [orderId, ok ? 'PAID' : 'PAYMENT_FAILED'],
    );
    let stored: Stored;
    if (!upd.rowCount) {
      // Otro proceso (ej. hold.expired) cambió el pedido mientras tanto: no se cobra.
      stored = {
        statusCode: 409,
        body: { error: { code: 'ORDER_NOT_PENDING', message: 'El pedido cambió de estado durante el pago' } },
      };
    } else {
      const o = upd.rows[0];
      await c.query('INSERT INTO payments (order_id, amount, method, status) VALUES ($1, $2, $3, $4)', [
        orderId,
        o.total,
        input.method,
        ok ? 'SUCCEEDED' : 'FAILED',
      ]);
      if (ok) {
        await enqueueEvent(
          c,
          'payment.succeeded',
          {
            orderId,
            holdId: o.hold_id,
            eventId: o.event_id,
            userId: o.user_id,
            email: o.user_email,
            seatIds: o.seat_ids,
            amount: Number(o.total),
          },
          correlationId,
        );
      } else {
        await enqueueEvent(
          c,
          'payment.failed',
          { orderId, holdId: o.hold_id, reason: 'Pago rechazado (simulado)' },
          correlationId,
        );
      }
      stored = { statusCode: 200, body: { orderId, status: o.status } };
    }
    await saveResponse(c, user.id, key, stored.statusCode, stored.body);
    return stored;
  });

  if (result.statusCode === 200) paymentsTotal.inc({ result: ok ? 'success' : 'failed' });
  void flushOutbox(); // publicar ya, sin esperar al worker
  return result;
}
