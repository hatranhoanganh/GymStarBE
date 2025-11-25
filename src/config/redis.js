import { createClient } from "redis";

const isProduction = process.env.NODE_ENV === "production";
const redisUrl = process.env.REDIS_URL;

const redisOptions = { url: redisUrl, socket: {} };

if (isProduction) {
  redisOptions.socket.tls = true;
  redisOptions.socket.rejectUnauthorized = false;
}
let isConnected = false;

const redis = createClient(redisOptions);

async function connectRedis() {
  if (!isConnected) {
    await redis.connect();
    isConnected = true;
  }
}


// **CHỈ EXPORT 2 THỨ**
export { redis, connectRedis };

// Nếu muốn tự động connect khi import
connectRedis().catch(console.error);
