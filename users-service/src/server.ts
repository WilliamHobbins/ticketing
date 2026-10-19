import { app } from "./app";
import { config } from "./config";
import { initializeDatabase, pool } from "./db";
import { logger } from "./logger";

async function main(): Promise<void> {
  await initializeDatabase();
  const server = app.listen(config.PORT, "0.0.0.0", () => {
    logger.info({ port: config.PORT }, "users_service_started");
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, "graceful_shutdown_started");
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "users_service_startup_failed");
  process.exit(1);
});
