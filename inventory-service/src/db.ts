import { Pool } from "pg";
import { config } from "./config";
import { logger } from "./logger";

// Un Pool mantiene varias conexiones abiertas y las reutiliza entre pedidos.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 2000,
});

// Si una conexión inactiva falla, sin este manejador el proceso se caería.
pool.on("error", (err) => logger.error("Postgres pool error", { error: err.message }));