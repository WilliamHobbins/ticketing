import { Redis } from "ioredis";
import { config } from "./config";
import { logger } from "./logger";

export const redis = new Redis(config.redisUrl);

redis.on("error", (err) => logger.error("Redis error", { error: err.message }));