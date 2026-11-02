import { NextFunction, Request, Response } from "express";

type Level = "debug" | "info" | "warn" | "error";

// Campos extra opcionales. No uses estos nombres en "extra": timestamp, level, service, message.
export interface LogFields {
  correlationId?: string;
  [key: string]: unknown;
}

// Una línea JSON por evento, a la salida estándar (12-Factor: los logs son un flujo de eventos).
function write(level: Level, message: string, fields: LogFields = {}): void {
  const { correlationId, ...extra } = fields;
  const line = {
    timestamp: new Date().toISOString(),
    level,
    service: "inventory-service",
    correlationId: correlationId ?? null,
    message,
    ...extra,
  };
  process.stdout.write(JSON.stringify(line) + "\n");
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

// Para loguear un error sin romper si lo que se lanzó no es un Error.
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Un log por request, al terminar. /metrics y /health se saltean: son consultas
// automáticas cada pocos segundos y llenarían el log de ruido.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/metrics" || req.path === "/health") return next();
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    logger.info("request", {
      correlationId: res.locals.correlationId as string,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e4) / 100,
    });
  });
  next();
}