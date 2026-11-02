import "dotenv/config";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo (valor: "${raw}")`);
  }
  return value;
}

function requiredFromEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const config = {
  port: intFromEnv("PORT", 3003),
  databaseUrl: requiredFromEnv("DATABASE_URL"),
  brokerUrl: requiredFromEnv("BROKER_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  holdTtlSeconds: intFromEnv("HOLD_TTL_SECONDS", 600),
  holdExtendSeconds: intFromEnv("HOLD_EXTEND_SECONDS", 120),
  sweepIntervalSeconds: intFromEnv("SWEEP_INTERVAL_SECONDS", 5),
};