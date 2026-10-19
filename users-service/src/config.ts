import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  LOG_LEVEL: z.string().default("info")
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  // No imprimir valores de secretos al reportar errores de configuración.
  console.error("Configuración inválida:", parsed.error.issues.map(i => ({
    field: i.path.join("."),
    message: i.message
  })));
  process.exit(1);
}

export const config = parsed.data;
