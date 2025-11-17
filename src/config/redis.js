// src/config/redis.js
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// === ĐẢM BẢO CHỈ KẾT NỐI 1 LẦN ===
let isConnected = false;
let connectPromise = null;

const connectRedis = async () => {
  if (isConnected) return;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      await redis.connect();
      isConnected = true;
      console.log('Redis connected successfully');
    } catch (err) {
      isConnected = false;
      connectPromise = null;
      console.error('Redis connection failed:', err);
      throw err;
    }
  })();

  return connectPromise;
};

// === TỰ ĐỘNG KẾT NỐI KHI IMPORT ===
connectRedis().catch(() => {});

export default redis;
export { connectRedis };