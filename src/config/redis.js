import { createClient } from "redis";

const host = process.env.REDIS_HOST;
const port = process.env.REDIS_PORT || 6379;
const password = process.env.REDIS_PASSWORD;

// Kiểm tra host
if (!host) {
  console.warn("⚠️ REDIS_HOST chưa set. Redis sẽ không kết nối.");
}

// Tạo URL động
// Nếu muốn dùng TLS, bạn có thể set REDIS_USE_TLS=true
const useTls = process.env.REDIS_USE_TLS === "true";

// Nếu dùng TLS, URL phải là rediss://
// Nếu không dùng TLS, URL là redis://
const protocol = useTls ? "rediss" : "redis";
const redisUrl = `${protocol}://${password ? `:${password}@` : ""}${host}:${port}`;

const redis = createClient({
  url: redisUrl,
  socket: {
    tls: useTls,
    rejectUnauthorized: false, // cho cloud TLS
  },
});

redis.on("error", (err) => console.error("Redis Client Error:", err));

let isConnected = false;
export async function connectRedis() {
  if (!isConnected && host) {
    await redis.connect();
    isConnected = true;
    console.log("✅ Redis connected");
  }
}

export { redis };
