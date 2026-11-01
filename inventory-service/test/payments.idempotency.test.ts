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
  publishPaymentSucceeded,
  resetTestEvent,
  sleep,
  startSaleRejectedListener,
  TEST_EVENT,
  waitFor,
} from "./helpers";

describe("Idempotencia del consumidor payment.succeeded", () => {
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

  it("el mismo payment.succeeded repetido 3 veces vende una sola vez", async () => {
    const listener = await startSaleRejectedListener();
    try {
      const msg = {
        messageId: `test-${randomUUID()}`,
        orderId: "o-test-1",
        holdId: "h-test-1",
        seatIds: ["T1-1"],
      };

      // Tres copias del mismo mensaje (mismo messageId), publicadas a la vez.
      await Promise.all([publishPaymentSucceeded(msg), publishPaymentSucceeded(msg), publishPaymentSucceeded(msg)]);

      // Esperamos a que el consumidor registre el messageId...
      await waitFor(async () => (await countProcessed(msg.messageId)) === 1, "que se procese el mensaje");
      // ...y le damos margen para que termine de descartar las copias duplicadas.
      await sleep(1500);

      assert.equal(await countProcessed(msg.messageId), 1, "una sola fila en processed_messages");

      const seat = await getSeat("T1-1");
      assert.equal(seat.status, "SOLD");
      assert.equal(seat.order_id, "o-test-1", "el asiento quedó vendido a ese pedido");

      assert.equal(listener.rejected().length, 0, "no se publicó ningún sale.rejected");
      assert.equal(await redis.get(`seat:${TEST_EVENT}:T1-1`), null, "la clave de Redis quedó liberada");
    } finally {
      await listener.close();
    }
  });

  it("dos ventas concurrentes sobre el mismo asiento: una vende y la otra se rechaza", async () => {
    const listener = await startSaleRejectedListener();
    try {
      const a = { messageId: `test-${randomUUID()}`, orderId: "o-test-A", holdId: "h-test-A", seatIds: ["T1-2"] };
      const b = { messageId: `test-${randomUUID()}`, orderId: "o-test-B", holdId: "h-test-B", seatIds: ["T1-2"] };

      await Promise.all([publishPaymentSucceeded(a), publishPaymentSucceeded(b)]);

      // Las dos filas de processed_messages aparecen cuando ambos mensajes se resolvieron.
      await waitFor(
        async () => (await countProcessed(a.messageId)) === 1 && (await countProcessed(b.messageId)) === 1,
        "que se procesen los dos mensajes",
      );
      await waitFor(async () => listener.rejected().length >= 1, "el sale.rejected del perdedor");
      await sleep(500); // margen por si llegara un segundo rechazo inesperado

      const rejected = listener.rejected();
      assert.equal(rejected.length, 1, "se rechaza exactamente una venta");
      const loserOrder = rejected[0].data.orderId as string;
      assert.ok(["o-test-A", "o-test-B"].includes(loserOrder));
      assert.ok(
        ["SEAT_ALREADY_SOLD", "SEAT_TAKEN"].includes(rejected[0].data.reason),
        `motivo inesperado: ${rejected[0].data.reason}`,
      );

      const winnerOrder = loserOrder === "o-test-A" ? "o-test-B" : "o-test-A";
      const seat = await getSeat("T1-2");
      assert.equal(seat.status, "SOLD");
      assert.equal(seat.order_id, winnerOrder, "el asiento quedó con un solo order_id: el del ganador");
    } finally {
      await listener.close();
    }
  });
});