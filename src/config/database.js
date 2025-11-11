// src/config/database.js
import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === CHỈ LOAD .env.local KHI LOCAL (development) ===
if (process.env.NODE_ENV !== "production") {
  const envPath = path.join(__dirname, "../../.env.local");
  dotenv.config({ path: envPath });
  console.log(`[LOCAL] Loaded .env.local: ${envPath}`);
}

console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "YES" : "NO");

// === ƯU TIÊN DATABASE_URL (Render) ===
let sequelize;

if (process.env.DATABASE_URL) {
  console.log("Dùng DATABASE_URL (Render/Production)");
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false,
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false },
    },
    define: { timestamps: true, underscored: true },
    pool: { max: 10, min: 0, acquire: 60000, idle: 10000 },
  });
} 
// === LOCAL DB ===
else {
  console.log("Dùng DB local (development)");
  const required = ["DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST"];
  required.forEach(key => {
    if (!process.env[key]) {
      console.error(`Missing env: ${key}`);
      process.exit(1);
    }
  });

  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      dialect: "postgres",
      logging: false,
      dialectOptions: process.env.DB_SSL === "true"
        ? { ssl: { require: true, rejectUnauthorized: false } }
        : false,
      define: { timestamps: true, underscored: true },
      pool: { max: 10, min: 0, acquire: 60000, idle: 10000 },
    }
  );
}

export default sequelize;