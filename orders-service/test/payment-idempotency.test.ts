import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const INVENTORY = process.env.INVENTORY_URL ?? 'http://localhost:8083';
const ORDERS = process.env.ORDERS_URL ?? 'http://localhost:3004';
const host = process.env.PGHOST ?? 'localhost';

// Usuario y clave salen de PGUSER y PGPASSWORD (variables de entorno)
const inventoryDb = new Pool({ host, database: 'ticketing_inventory' });
const ordersDb = new Pool({ host, database: 'ticketing_orders' });

const eventId = `evt-test-${Date.now()}`;
const seatIds = ['T1-1', 'T1-2'];
const headers = {
    'Content-Type': 'application/json',
    'X-User-Id': randomUUID(),
    'X-User-Email': 'test@test.com',
};

after(async () => {
    await inventoryDb.query('DELETE FROM seats WHERE event_id = $1', [eventId]);
    await inventoryDb.query('DELETE FROM events WHERE id = $1', [eventId]);
    await inventoryDb.end();
    await ordersDb.end();
});

test('pagar dos veces con la misma Idempotency-Key cobra una sola vez', async () => {
    // 1. Datos de prueba en inventory
    await inventoryDb.query(
        `INSERT INTO events (id, name, starts_at) VALUES ($1, 'Evento de test', '2026-12-31T21:00:00Z')`,
        [eventId],
    );
    for (const [i, seatId] of seatIds.entries()) {
        await inventoryDb.query(
            `INSERT INTO seats (event_id, seat_id, sector, row_num, seat_num, price) VALUES ($1, $2, 'T1', 1, $3, 50)`,
            [eventId, seatId, i + 1],
        );
    }

    // 2. Hold y pedido
    const holdRes = await fetch(`${INVENTORY}/api/v1/holds`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ eventId, seatIds }),
    });
    assert.equal(holdRes.status, 201);
    const hold = (await holdRes.json()) as { holdId: string };

    const orderRes = await fetch(`${ORDERS}/api/v1/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ holdId: hold.holdId }),
    });
    assert.equal(orderRes.status, 201);
    const order = (await orderRes.json()) as { orderId: string; status: string };
    assert.equal(order.status, 'PENDING_PAYMENT');

    // 3. Pagar dos veces con la misma clave

    const key = `test-${randomUUID()}`;
    const payWithKey = () =>
        fetch(`${ORDERS}/api/v1/orders/${order.orderId}/pay`, {
            method: 'POST',
            headers: { ...headers, 'Idempotency-Key': key },
            body: JSON.stringify({ method: 'mock', simulate: 'success' }),
        });

    const first = await payWithKey();
    const second = await payWithKey();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(((await first.json()) as { status: string }).status, 'PAID');
    assert.equal(((await second.json()) as { status: string }).status, 'PAID');

    // 4. Un solo cobro en la base
    const r = await ordersDb.query('SELECT count(*)::int AS n FROM payments WHERE order_id = $1', [order.orderId]);
    assert.equal(r.rows[0].n, 1);
});