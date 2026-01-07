// index.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import sequelize from "./src/config/database.js";
import rootRoutes from "./src/routes/root.router.js";
import initModels from "./src/models/init-models.js";
import { connectRedis } from "./src/config/redis.js";
connectRedis(); 


const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.join(__dirname, ".env.local")   });
}

const app = express();

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://gymstar.netlify.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


app.use((req, res, next) => {
  req.sequelize = sequelize;
  req.models = sequelize.models;
  next();
});

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "GymStar Backend OK",
    env: process.env.NODE_ENV,
    time: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
  });
});

app.use(rootRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("ERROR:", err.message);
  res.status(500).json({ message: "Lỗi server" });
});

// === KHỞI ĐỘNG ===
const PORT = process.env.SERVER_PORT || 10000;

const startServer = async () => {
  try {
    // Kết nối DB và sync DEV (tất cả lỗi sẽ được throw)
    await sequelize.authenticate();
    if (process.env.NODE_ENV !== "production") {
      initModels(sequelize);
      await sequelize.sync();
    }

    // Khởi động server (chỉ log server)
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("STARTUP FAILED:", err.message);
    process.exit(1);
  }
};

startServer();
