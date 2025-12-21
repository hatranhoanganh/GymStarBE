import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });  

import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("❌ REDIS_URL chưa được set trong .env");
}


const useTls = redisUrl.startsWith("rediss://");



const redis = createClient({
  url: redisUrl,
  socket: useTls
    ? {
        tls: true,
        rejectUnauthorized: false,
      }
    : {},
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

let isConnected = false;

export async function connectRedis() {
  if (!isConnected) {
    await redis.connect();
    isConnected = true;
 
  }
}

export { redis };