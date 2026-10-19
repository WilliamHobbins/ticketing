import pino from "pino";
import { config } from "./config";

// Campos fijos del equipo: timestamp, level, service, correlationId, message.
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: "users-service" },
  messageKey: "message",
  timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => ({ level: label })
  },
  redact: {
    paths: ["password", "password_hash", "token", "accessToken", "*.password", "*.password_hash", "*.token", "*.accessToken"],
    censor: "[REDACTED]"
  }
});
