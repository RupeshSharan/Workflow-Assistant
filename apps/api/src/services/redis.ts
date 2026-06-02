import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";

const redisConnectionUrl = config.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(redisConnectionUrl, {
  maxRetriesPerRequest: null
});

redis.on("error", (error) => {
  logger.error({ error }, "Unexpected Redis connection error");
});

export async function closeRedis(): Promise<void> {
  await redis.quit();
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    logger.warn({ error, key }, "Failed to get cached data from Redis");
    return null;
  }
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    logger.warn({ error, key }, "Failed to set cached data in Redis");
  }
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch (error) {
    logger.warn({ error, key }, "Failed to invalidate cache in Redis");
  }
}
