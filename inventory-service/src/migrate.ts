import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "./db";
import { errorMessage, logger } from "./logger";

async function main() {
  const sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
  await pool.query(sql);
  logger.info("Schema aplicado")
  await pool.end();
}

main().catch((err) => {
  logger.error("Falló la migración", { error: errorMessage(err) })
  process.exit(1);
});