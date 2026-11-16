import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { ApiError } from "./errors";
import { eventsRouter, holdsRouter } from "./routes";
import { pool } from "./db";
import { redis } from "./redis";
import { startConsumer } from "./consumer";
import { startSweeper } from "./sweeper";
import { startPaymentConsumers } from "./payments";
import { httpMetrics, register } from "./metrics";
import { errorMessage, logger, requestLogger } from "./logger";
import { startOutboxWorker, stopOutboxWorker } from "./outbox";

const app = express();

// X-Correlation-Id: si viene, lo reutilizamos; si no, lo generamos. Siempre se devuelve.
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.header("X-Correlation-Id") || randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
});

app.use(httpMetrics);

app.use(requestLogger);

app.use(express.json());

// Si la dependencia no responde en 2 s, la damos por caída.
function withTimeout<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

app.get("/health", async (_req, res) => {
  const [pg, rd] = await Promise.allSettled([
    withTimeout(pool.query("SELECT 1")),
    withTimeout(redis.ping()),
  ]);
  const postgres = pg.status === "fulfilled" ? "ok" : "down";
  const redisStatus = rd.status === "fulfilled" ? "ok" : "down";
  const healthy = postgres === "ok" && redisStatus === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    postgres,
    redis: redisStatus,
  });
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.send(await register.metrics());
});

app.use("/api/v1/holds", holdsRouter);
app.use("/api/v1/events", eventsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta inexistente" } });
});

// Manejador global: toda respuesta de error sale con el formato del contrato.
// Express 5 manda acá también los errores de handlers async.
// Los 4 parámetros son obligatorios para que Express lo reconozca como manejador de errores.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details) error.details = err.details;
    return res.status(err.status).json({ error });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "INVALID_JSON", message: "El body no es un JSON válido" } });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "El body es demasiado grande" } });
  }
  logger.error("Unhandled error", {
    correlationId: res.locals.correlationId as string,
    error: errorMessage(err),
    stack: err?.stack,
  });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno" } });
});

const server = app.listen(config.port, () => {
  logger.info("inventory-service listening", { port: config.port });
  void startConsumer();
  void startSweeper();
  startPaymentConsumers();
  startOutboxWorker();
});

// Apagado ordenado (12-Factor, factor IX): ante SIGTERM/SIGINT dejamos de aceptar
// conexiones, cerramos Redis y Postgres y salimos. Si en 10 s no terminó, salimos igual.
let shuttingDown = false;

const shutdown = (signal: string) => {
  if (shuttingDown) return; // si llega la señal dos veces, no repetimos el apagado
  shuttingDown = true;
  logger.info("Apagando inventory-service", { signal });

  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();

  server.close(async () => {
    await stopOutboxWorker();
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  });
  // Cierra las conexiones HTTP en reposo para que server.close no se quede esperando.
  (server as any).closeIdleConnections?.();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));