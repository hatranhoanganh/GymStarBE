import { createClient } from "redis";

const redisUrl = "redis://default:v90jUOxDjn4mX3xdQoGdHmEqaD2u4xn1@redis-14488.crce199.us-west-2-2.ec2.cloud.redislabs.com:14488";

const redis = createClient({ url: redisUrl });

redis.on("error", (err) => console.error("Redis error:", err));

const deleteOldOTP = async (email) => {
  try {
    await redis.connect();
    await redis.del(`otp:${email}`);
    await redis.del(`otp:cooldown:${email}`);
    await redis.del(`otp:limit:${email}`);
    console.log("✅ Đã xóa OTP trên Redis Cloud cho email:", email);
  } catch (err) {
    console.error(err);
  } finally {
    await redis.disconnect();
    process.exit();
  }
};

const email = process.argv[2];
if (!email) {
  console.log("Vui lòng truyền email: node deleteOldOTP.js test@example.com");
  process.exit(1);
}

deleteOldOTP(email);
// node src/config/deleteOldOTP.js anhha23112003@gmail.com <---lệnh dùng để chạy terminall xóa otp cũ trên redis cloud
