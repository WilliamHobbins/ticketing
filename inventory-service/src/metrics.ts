import { NextFunction, Request, Response } from "express";
import * as client from "prom-client";

// Registro propio: todas las métricas del servicio viven acá.
export const register = new client.Registry();

// Etiqueta que se agrega a todas las métricas, para distinguir este servicio en Grafana.
register.setDefaultLabels({ service: "inventory-service" });

// Métricas estándar del proceso (memoria, CPU, event loop...). Vienen gratis con la librería.
client.collectDefaultMetrics({ register });

const LABELS = ["method", "route", "status"];

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Cantidad de requests HTTP atendidos",
  labelNames: LABELS,
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Latencia de los requests HTTP en segundos",
  labelNames: LABELS,
  registers: [register],
});

// Se engancha dentro de cada router: guarda por dónde está montado (ej. /api/v1/holds),
// porque Express vacía req.baseUrl cuando el request sale del router.
export function captureBase(req: Request, res: Response, next: NextFunction): void {
  res.locals.baseUrl = req.baseUrl;
  next();
}

// Etiqueta con el patrón de la ruta (/api/v1/holds/:holdId) y no con la URL real,
// para no generar una serie nueva por cada holdId.
function routeLabel(req: Request, res: Response): string {
  if (!req.route) return "unmatched"; // 404: ninguna ruta lo atendió
  const path = String(res.locals.baseUrl ?? "") + String(req.route.path);
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/metrics") return next(); // no medimos las consultas a /metrics
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const labels = { method: req.method, route: routeLabel(req, res), status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}

// ---------- Métricas de negocio ----------

export const holdsCreatedTotal = new client.Counter({
  name: "holds_created_total",
  help: "Holds (reservas temporales) creados con éxito",
  registers: [register],
});

export const holdsExpiredTotal = new client.Counter({
  name: "holds_expired_total",
  help: "Holds vencidos cuyo evento hold.expired se publicó",
  registers: [register],
});

export const holdExpiredPublishErrorsTotal = new client.Counter({
  name: "hold_expired_publish_errors_total",
  help: "Fallos al publicar hold.expired (se reintentan solos)",
  registers: [register],
});

export const salesConfirmedTotal = new client.Counter({
  name: "sales_confirmed_total",
  help: "Ventas confirmadas (asientos pasados a SOLD)",
  registers: [register],
});

// reason tiene solo 3 valores posibles (SEAT_TAKEN, SEAT_ALREADY_SOLD, SEAT_NOT_FOUND).
export const salesRejectedTotal = new client.Counter({
  name: "sales_rejected_total",
  help: "Ventas rechazadas (se publicó sale.rejected)",
  labelNames: ["reason"],
  registers: [register],
});

export const holdsReleasedByPaymentTotal = new client.Counter({
  name: "holds_released_by_payment_total",
  help: "Holds liberados por un payment.failed",
  registers: [register],
});