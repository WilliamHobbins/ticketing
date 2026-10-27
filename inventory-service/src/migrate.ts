import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "./db";

async function main() {
  const sql = readFileSync(resolve(process.cwd(), "db/schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Schema aplicado");
  await pool.end();
}

main().catch((err) => {
  console.error("Falló la migración:", err);
  process.exit(1);
});