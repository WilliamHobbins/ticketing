import promClient from "prom-client";

export const registry = new promClient.Registry();
promClient.collectDefaultMetrics({ register: registry, prefix: "users_service_" });

export const httpRequests = new promClient.Counter({
  name: "users_service_http_requests_total",
  help: "Cantidad de requests HTTP procesados",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry]
});

export const httpDuration = new promClient.Histogram({
  name: "users_service_http_request_duration_seconds",
  help: "Duración de requests HTTP en segundos",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry]
});

export const userRegistrations = new promClient.Counter({
  name: "users_service_registrations_total",
  help: "Intentos de registro completados correctamente",
  registers: [registry]
});

export const loginSuccesses = new promClient.Counter({
  name: "users_service_login_success_total",
  help: "Logins exitosos",
  registers: [registry]
});

export const loginFailures = new promClient.Counter({
  name: "users_service_login_failure_total",
  help: "Logins fallidos",
  registers: [registry]
});
