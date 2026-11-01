import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { redis } from "../src/redis";
import {
  assertServiceUp,
  closeConnections,
  dropTestEvent,
  postHold,
  resetTestEvent,
  TEST_EVENT,
} from "./helpers";

describe("Concurrencia en holds", () => {
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

  it("50 holds en paralelo sobre el mismo asiento: gana exactamente uno", async () => {
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => postHold(`user-${i}`, ["T1-1"])),
    );

    const winners = results
      .map((r, i) => ({ ...r, userId: `user-${i}` }))
      .filter((r) => r.status === 201);
    const losers = results.filter((r) => r.status === 409);

    assert.equal(winners.length, 1, "tiene que ganar exactamente un hold");
    assert.equal(losers.length, N - 1, "todos los demás reciben 409");
    for (const l of losers) {
      assert.equal(l.body.error.code, "SEAT_UNAVAILABLE");
      assert.deepEqual(l.body.error.details.seatIds, ["T1-1"]);
    }

    // Redis tiene que reflejar al ganador.
    const winner = winners[0]!;
    const owner = await redis.get(`seat:${TEST_EVENT}:T1-1`);
    assert.equal(owner, winner.body.holdId, "el asiento pertenece al hold ganador");
    assert.equal(await redis.hget(`hold:${winner.body.holdId}`, "userId"), winner.userId);
    assert.equal((await redis.zscore("holds:expiry", winner.body.holdId)) !== null, true);
  });

  it("asientos solapados: gana un solo hold y no queda nada a medias", async () => {
    // 25 usuarios piden [T1-1, T1-2] y 25 piden [T1-2, T1-3]; comparten T1-2.
    const groupA = ["T1-1", "T1-2"];
    const groupB = ["T1-2", "T1-3"];
    const requests = Array.from({ length: 50 }, (_, i) => {
      const seatIds = i % 2 === 0 ? groupA : groupB;
      return postHold(`user-${i}`, seatIds).then((r) => ({ ...r, seatIds }));
    });
    const results = await Promise.all(requests);

    const winners = results.filter((r) => r.status === 201);
    const losers = results.filter((r) => r.status === 409);
    assert.equal(winners.length, 1, "tiene que ganar exactamente un hold");
    assert.equal(losers.length, 49, "todos los demás reciben 409");

    const winner = winners[0]!;
    const winnerSeats = winner.seatIds;
    const otherSeats = ["T1-1", "T1-2", "T1-3"].filter((s) => !winnerSeats.includes(s));

    // Los asientos del ganador son suyos...
    for (const s of winnerSeats) {
      assert.equal(await redis.get(`seat:${TEST_EVENT}:${s}`), winner.body.holdId);
    }
    // ...y el asiento que solo pedía el otro grupo quedó libre (nada a medias).
    for (const s of otherSeats) {
      assert.equal(await redis.get(`seat:${TEST_EVENT}:${s}`), null, `${s} no debería estar reservado`);
    }
    // El hold ganador existe en Redis.
    assert.equal(await redis.exists(`hold:${winner.body.holdId}`), 1);
  });
});