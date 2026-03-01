import Redis from "ioredis";
import { config } from "../config";
import { logger } from "../utils/logger";

export const redis = new Redis(config.redis.url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

let redisErrorLogged = false;
redis.on("error", (err) => {
  if (!redisErrorLogged) {
    logger.warn({ err }, "Redis connection error (further errors suppressed)");
    redisErrorLogged = true;
  }
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

/**
 * Test Redis connectivity. Returns true if the connection succeeds.
 */
export async function testRedis(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch (err) {
    logger.error({ err }, "Redis connection test failed");
    return false;
  }
}
