import express from "express";

import userRouter from "./user.router.js";

// tạo object router tổng
const rootRoutes = express.Router();



rootRoutes.use("/QuanLyNguoiDung", userRouter);

// // export rootRoutes cho index.js dùng
export default rootRoutes;
