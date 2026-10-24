import { randomUUID } from "node:crypto";
import express, { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { ApiError } from "./errors";
import { holdsRouter } from "./routes";

const app = express();

// X-Correlation-Id: si viene, lo reutilizamos; si no, lo generamos. Siempre se devuelve.
app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.header("X-Correlation-Id") || randomUUID();
  res.locals.correlationId = correlationId;
  res.setHeader("X-Correlation-Id", correlationId);
  next();
});

app.use(express.json());

// Sin prefijo (paso 7 agrega /metrics)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/v1/holds", holdsRouter);

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
  console.error("Unhandled error:", err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno" } });
});

app.listen(config.port, () => {
  console.log(`inventory-service listening on port ${config.port}`);
});