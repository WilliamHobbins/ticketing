import express, { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "./db";
import { logger } from "./logger";
import {
  httpRequests, httpDuration, registry,
  userRegistrations, loginSuccesses, loginFailures
} from "./metrics";
import { createAccessToken, verifyAccessToken } from "./auth";

declare module "express-serve-static-core" {
  interface Request {
    log: typeof logger;
    correlationId: string;
  }
}

// Hash descartable para que login tarde lo mismo exista o no el email
// (evita enumerar usuarios midiendo tiempos de respuesta).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId = req.header("x-correlation-id") || randomUUID();
  req.correlationId = correlationId;
  req.log = logger.child({ correlationId });
  res.setHeader("X-Correlation-Id", correlationId);
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    // Rutas no registradas se agrupan para no inflar la cardinalidad de métricas.
    const route = req.route?.path ? String(req.route.path) : "unmatched";
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, duration);
    req.log.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(duration * 1000)
    }, "http_request_completed");
  });
  next();
});

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(10).max(72)
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(1).max(72)
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", service: "users-service", dependencies: { postgres: "ok" } });
  } catch {
    res.status(503).json({ status: "error", service: "users-service", dependencies: { postgres: "unavailable" } });
  }
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

app.post("/api/v1/users/register", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Datos de registro inválidos" } });
      return;
    }

    const { name, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const id = randomUUID();

    let createdAt: Date;
    try {
      const inserted = await pool.query(
        "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING created_at",
        [id, name, email, passwordHash]
      );
      createdAt = inserted.rows[0].created_at;
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        res.status(409).json({ error: { code: "EMAIL_ALREADY_EXISTS", message: "Ya existe un usuario con ese email" } });
        return;
      }
      throw error;
    }

    userRegistrations.inc();
    req.log.info({ userId: id }, "user_registered");
    res.status(201).json({ id, name, email, createdAt: createdAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/users/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Email o contraseña inválidos" } });
      return;
    }

    const { email, password } = parsed.data;
    const result = await pool.query(
      "SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];

    const passwordOk = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordOk) {
      loginFailures.inc();
      req.log.warn("login_failed");
      res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Credenciales inválidas" } });
      return;
    }

    loginSuccesses.inc();
    req.log.info({ userId: user.id }, "login_succeeded");
    const accessToken = createAccessToken({ id: user.id, email: user.email });
    res.status(200).json({
      accessToken,
      tokenType: "Bearer",
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/users/me", (req, res) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Se requiere un token Bearer" } });
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    res.status(200).json({ id: payload.sub, email: payload.email });
  } catch {
    res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Token inválido o expirado" } });
  }
});

// Nginx auth_request: 2xx permite la solicitud; 401/403 la bloquea.
// Este endpoint no debe publicarse directamente fuera de la red Docker.
app.get("/internal/validate", (req, res) => {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).end();
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice("Bearer ".length));
    // El gateway copia estas cabeceras hacia los servicios internos (auth_request_set).
    res.setHeader("X-User-Id", payload.sub);
    res.setHeader("X-User-Email", payload.email);
    res.status(204).end();
  } catch {
    res.status(401).end();
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta no encontrada" } });
});

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  // Errores del parser de body (JSON mal formado, body demasiado grande) son culpa del cliente, no 500.
  const type = typeof error === "object" && error !== null && "type" in error ? String(error.type) : "";
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "El cuerpo de la solicitud no es un JSON válido" } });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "El cuerpo de la solicitud es demasiado grande" } });
    return;
  }
  (req.log ?? logger).error({ err: error }, "unhandled_request_error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
});

export { app };
