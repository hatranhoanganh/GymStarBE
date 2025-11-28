import express from "express";

import userRouter from "./user.router.js";
import CategoryRouter from "./category.router.js";
import ProductRouter from "./product.router.js";
import CartRouter from "./cart.router.js";

// tạo object router tổng
const rootRoutes = express.Router();

rootRoutes.use("/QuanLyNguoiDung", userRouter);
rootRoutes.use("/QuanLyDanhMuc", CategoryRouter);
rootRoutes.use("/QuanLySanPham", ProductRouter);
rootRoutes.use("/QuanLyGioHang", CartRouter);

// // export rootRoutes cho index.js dùng
export default rootRoutes;
