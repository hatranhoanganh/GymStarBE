import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });  // thêm dòng này nếu chưa load .env

import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error("❌ REDIS_URL chưa được set trong .env");
}

// Nếu URL bắt đầu bằng rediss:// → TLS
const useTls = redisUrl.startsWith("rediss://");

// console.log("🔌 Redis URL:", redisUrl);
// console.log("🔐 TLS enabled:", useTls);

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
    // console.log("✅ Redis connected");
  }
}

export { redis };