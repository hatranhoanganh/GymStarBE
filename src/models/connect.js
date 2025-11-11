// // src/models/connect.js
// import { Sequelize } from "sequelize";
// import dotenv from "dotenv";

// dotenv.config();

// // LOG ra để kiểm tra môi trường
// console.log("MODE:", process.env.NODE_ENV || "development");
// console.log("DATABASE_URL:", process.env.DATABASE_URL || "(none)");

// // ⚙️ 1️⃣ Nếu có DATABASE_URL (Render), thì dùng luôn
// let sequelize;

// if (process.env.DATABASE_URL) {
//   sequelize = new Sequelize(process.env.DATABASE_URL, {
//     dialect: "postgres",
//     logging: process.env.NODE_ENV === "development" ? console.log : false,
//     dialectOptions: {
//       ssl: {
//         require: true,
//         rejectUnauthorized: false,
//       },
//     },
//     define: {
//       timestamps: true,
//       underscored: true,
//       freezeTableName: true,
//     },
//     pool: {
//       max: 10,
//       min: 0,
//       acquire: 60000,
//       idle: 10000,
//     },
//     retry: {
//       match: [
//         /ECONNRESET/,
//         /ETIMEDOUT/,
//         /ESOCKETTIMEDOUT/,
//         /ENOTFOUND/,
//         /Connection terminated/,
//         /SequelizeConnectionError/,
//       ],
//       max: 15,
//     },
//   });

//   console.log("🟢 Dùng DATABASE_URL (Render/Production)");
// }

// // ⚙️ 2️⃣ Nếu không có DATABASE_URL (Local), tạo thủ công
// else {
//   sequelize = new Sequelize(
//     process.env.DB_NAME,
//     process.env.DB_USER,
//     process.env.DB_PASSWORD,
//     {
//       host: process.env.DB_HOST,
//       port: process.env.DB_PORT || 5432,
//       dialect: "postgres",
//       logging: process.env.NODE_ENV === "development" ? console.log : false,
//       dialectOptions: {
//         ssl:
//           process.env.DB_SSL === "true"
//             ? { require: true, rejectUnauthorized: false }
//             : false,
//       },
//       define: {
//         timestamps: true,
//         underscored: true,
//         freezeTableName: true,
//       },
//       pool: {
//         max: 10,
//         min: 0,
//         acquire: 60000,
//         idle: 10000,
//       },
//     }
//   );

//   console.log("🟢 Dùng DB thông thường (Local)");
// }

// // ⚙️ 3️⃣ Kết nối với retry
// const connectDB = async () => {
//   for (let i = 0; i < 5; i++) {
//     try {
//       await sequelize.authenticate();
//       console.log("✅ KẾT NỐI DATABASE THÀNH CÔNG!");
//       return;
//     } catch (err) {
//       console.error(`❌ Lần ${i + 1} thất bại:`, err.message);
//       if (i === 4) {
//         console.error("⛔ KHÔNG THỂ KẾT NỐI DB – DỪNG SERVER!");
//         process.exit(1);
//       }
//       await new Promise((res) => setTimeout(res, 5000));
//     }
//   }
// };

// connectDB();

// export default sequelize;
