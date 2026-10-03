import { createClient } from 'redis';
import { logger } from '../config/logger.js';

export const redis = createClient({
  url: process.env.REDIS_URL || undefined,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 2000)
  }
});

redis.on('error', (error) => {
  logger.error({ err: error.message }, 'Redis client error');
});

export async function connectRedis() {
  if (!redis.isOpen) {
    await redis.connect();
  }

  return redis;
}

export async function pingRedis() {
  await connectRedis();
  return redis.ping();
}

export async function closeRedis() {
  if (redis.isOpen) {
    await redis.quit();
  }
}
