import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'notifier-worker' },
  messageKey: 'message',
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: { level: (label) => ({ level: label }) },
});
export type Logger = typeof logger;
