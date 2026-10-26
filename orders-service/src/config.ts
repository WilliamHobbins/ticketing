import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3004),
  DATABASE_URL: z.string().min(1),
  BROKER_URL: z.string().min(1),
  INVENTORY_URL: z.string().url(),
  EVENTS_EXCHANGE: z.string().default('ticketing.events'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

function loadConfig(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // El logger todavía no existe (depende de la config), por eso se usa console.
    console.error(
      JSON.stringify({
        level: 'fatal',
        service: 'orders-service',
        message: 'Configuración inválida',
        issues: parsed.error.issues,
      }),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
