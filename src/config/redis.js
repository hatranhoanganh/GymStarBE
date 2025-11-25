// src/config/redis.js
import { createClient } from "redis";

let redisUrl = process.env.REDIS_URL;

// Nếu không có REDIS_URL → fallback về local Redis
if (!redisUrl) {
  console.warn("⚠️ REDIS_URL không có → dùng Redis local: redis://localhost:6379");
  redisUrl = "redis://localhost:6379";
}

// Nếu dùng local → KHÔNG dùng TLS
const isLocal = redisUrl.startsWith("redis://");

const redis = createClient({
  url: redisUrl,
  socket: {
    tls: !isLocal,               // Local: tắt TLS, Cloud: bật TLS
    rejectUnauthorized: false,
    connectTimeout: 5000,
    reconnectStrategy: false,
  },
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

let isConnected = false;

export async function connectRedis() {
  if (isConnected) return;

  console.log(`🔌 Connecting to Redis (${isLocal ? "Local" : "Cloud"})...`);

  await redis.connect();
  isConnected = true;

  console.log("✅ Redis connected!");

  // Giữ sống connection nếu cloud
  if (!isLocal) {
    setInterval(() => redis.ping(), 30000);
  }
}

export { redis };
