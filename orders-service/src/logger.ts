import pino from 'pino';
import { config } from './config';

// Logs JSON con los campos acordados: timestamp, level, service, correlationId, message.
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'orders-service' },
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label) => ({ level: label }) },
});

export type Logger = typeof logger;
