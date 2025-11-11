import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import sequelize from "./src/config/database.js";
import rootRoutes from "./src/routes/root.router.js";
import initModels from "./src/models/init-models.js";

// === CHỈ LOAD .env.local KHI LOCAL ===
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.NODE_ENV !== "production") {
  const envPath = path.join(__dirname, ".env.local");
  dotenv.config({ path: envPath });
  console.log(`[DEV] Loaded: ${envPath}`);
}

console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "YES" : "NO");

// Khởi tạo models
initModels(sequelize);

const app = express();

// CORS: Chỉ cho phép frontend
const allowedOrigins = [
  "http://localhost:5173",
  "https://gymstar.netlify.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked: ${origin}`);
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Gắn sequelize vào req
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
    console.log("Connecting to DB...");
    await sequelize.authenticate();
    console.log("DB connected");

    // CHỈ SYNC TRONG DEV – CẤM TRONG PRODUCTION
    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: true });
      console.log("Tables synced (DEV only)");
    } else {
      console.log("Production mode: Skipping sync – using migrations only");
    }

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