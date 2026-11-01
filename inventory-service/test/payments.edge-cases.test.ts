import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { redis } from "../src/redis";
import {
  assertServiceUp,
  closeConnections,
  countProcessed,
  dropTestEvent,
  getSeat,
  postHold,
  publishPaymentFailed,
  publishPaymentSucceeded,
  resetTestEvent,
  sleep,
  startSaleRejectedListener,
  TEST_EVENT,
  waitFor,
} from "./helpers";

const seatKey = (seatId: string) => `seat:${TEST_EVENT}:${seatId}`;

describe("Casos borde de pagos", () => {
  before(async () => {
    await assertServiceUp();
  });
  beforeEach(async () => {
    await resetTestEvent();
  });
  after(async () => {
    await dropTestEvent();
    await closeConnections();
  });

  it("payment.failed duplicado libera el hold y el asiento vuelve a estar disponible", async () => {
    const hold = await postHold("user-1", ["T1-3"]);
    assert.equal(hold.status, 201);
    const holdId = hold.body.holdId as string;
    assert.equal(await redis.get(seatKey("T1-3")), holdId);

    const msg = { messageId: `test-${randomUUID()}`, orderId: "o-test-F", holdId };
    await Promise.all([publishPaymentFailed(msg), publishPaymentFailed(msg)]);

    await waitFor(async () => (await countProcessed(msg.messageId)) === 1, "que se procese payment.failed");
    await sleep(1000); // margen para que se descarte la copia

    assert.equal(await countProcessed(msg.messageId), 1, "una sola fila en processed_messages");
    assert.equal(await redis.get(seatKey("T1-3")), null, "el asiento quedó libre en Redis");
    assert.equal(await redis.exists(`hold:${holdId}`), 0, "el hold se borró");
    assert.equal(await redis.zscore("holds:expiry", holdId), null, "el hold salió del índice de vencimientos");
    assert.equal((await getSeat("T1-3")).status, "AVAILABLE", "en Postgres nunca se vendió");

    // Otro usuario ya puede reservarlo.
    const again = await postHold("user-2", ["T1-3"]);
    assert.equal(again.status, 201);
  });

  it("hold vencido y nadie más tomó el asiento: el pago prevalece y se vende", async () => {
    const hold = await postHold("user-1", ["T1-4"]);
    assert.equal(hold.status, 201);
    const holdId = hold.body.holdId as string;

    // Simula el vencimiento por TTL: Redis borra la clave del asiento.
    await redis.del(seatKey("T1-4"));

    const listener = await startSaleRejectedListener();
    try {
      const msg = { messageId: `test-${randomUUID()}`, orderId: "o-test-V", holdId, seatIds: ["T1-4"] };
      await publishPaymentSucceeded(msg);
      await waitFor(async () => (await countProcessed(msg.messageId)) === 1, "que se procese el pago");
      await sleep(500);

      const seat = await getSeat("T1-4");
      assert.equal(seat.status, "SOLD");
      assert.equal(seat.order_id, "o-test-V");
      assert.equal(listener.rejected().length, 0, "no hay sale.rejected");
      assert.equal(await redis.get(seatKey("T1-4")), null, "la clave quedó liberada");
    } finally {
      await listener.close();
    }
  });

  it("hold vencido y otro usuario tomó el asiento: se rechaza la venta y no se pisa su reserva", async () => {
    const holdA = await postHold("user-1", ["T1-5"]);
    assert.equal(holdA.status, 201);
    const holdAId = holdA.body.holdId as string;

    await redis.del(seatKey("T1-5")); // vence el hold A
    const holdB = await postHold("user-2", ["T1-5"]);
    assert.equal(holdB.status, 201, "otro usuario puede reservar el asiento vencido");
    const holdBId = holdB.body.holdId as string;

    const listener = await startSaleRejectedListener();
    try {
      const msg = { messageId: `test-${randomUUID()}`, orderId: "o-test-X", holdId: holdAId, seatIds: ["T1-5"] };
      await publishPaymentSucceeded(msg);
      await waitFor(async () => listener.rejected().length >= 1, "el sale.rejected");
      await sleep(500);

      const rejected = listener.rejected();
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].data.orderId, "o-test-X");
      assert.equal(rejected[0].data.reason, "SEAT_TAKEN");

      assert.equal((await getSeat("T1-5")).status, "AVAILABLE", "el asiento no se vendió");
      assert.equal(await redis.get(seatKey("T1-5")), holdBId, "la reserva del usuario 2 sigue intacta");
    } finally {
      await listener.close();
    }
  });
});