import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3005),
  DATABASE_URL: z.string().min(1),
  BROKER_URL: z.string().min(1),
  EVENTS_EXCHANGE: z.string().default('ticketing.events'),
  LOG_LEVEL: z.string().default('info'),
});

export const config = schema.parse(process.env);
