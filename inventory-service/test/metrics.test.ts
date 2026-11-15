import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { TEST_EVENT, TEST_SEATS, closeConnections, dropTestEvent, resetTestEvent } from "./helpers";

const BASE = process.env.INVENTORY_URL ?? "http://localhost:8083";

async function metricsText(): Promise<string> {
  const res = await fetch(`${BASE}/metrics`);
  assert.equal(res.status, 200);
  return res.text();
}

// Lee el valor de un contador sin etiquetas propias, ej. holds_created_total{service="..."} 9
function counter(text: string, name: string): number {
  const match = text.match(new RegExp(`^${name}\\{[^}]*\\} (\\d+)`, "m"));
  assert.ok(match, `no aparece ${name} en /metrics`);
  return Number(match[1]);
}

describe("Métricas", () => {
  // Deja el evento de prueba (evt-test) limpio, igual que los otros tests.
  before(async () => {
    await resetTestEvent();
  });

  after(async () => {
    await dropTestEvent();
    await closeConnections();
  });

  it("GET /metrics responde en formato Prometheus", async () => {
    const res = await fetch(`${BASE}/metrics`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
    const text = await res.text();
    assert.match(text, /# TYPE http_requests_total counter/);
    assert.match(text, /# TYPE http_request_duration_seconds histogram/);
    assert.match(text, /# TYPE holds_created_total counter/);
    assert.match(text, /service="inventory-service"/);
  });

  it("crear un hold sube holds_created_total en 1", async () => {
    const before = counter(await metricsText(), "holds_created_total");

    const res = await fetch(`${BASE}/api/v1/holds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "user-metrics-test" },
      body: JSON.stringify({ eventId: TEST_EVENT, seatIds: [TEST_SEATS[0]] }),
    });
    assert.equal(res.status, 201);
    const { holdId } = (await res.json()) as { holdId: string };

    try {
      const after = counter(await metricsText(), "holds_created_total");
      assert.equal(after, before + 1);
    } finally {
      // Siempre liberamos el asiento, aunque el assert falle.
      await fetch(`${BASE}/api/v1/holds/${holdId}`, {
        method: "DELETE",
        headers: { "X-User-Id": "user-metrics-test" },
      });
    }
  });

  it("la etiqueta de ruta usa el patrón y no el id real", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    await fetch(`${BASE}/api/v1/holds/${id}`);
    const text = await metricsText();
    assert.match(text, /route="\/api\/v1\/holds\/:holdId"/);
    assert.ok(!text.includes(id), "el id real no debe aparecer en las etiquetas");
  });
});