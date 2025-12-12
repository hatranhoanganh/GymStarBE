import express from "express";

import userRouter from "./user.router.js";
import CategoryRouter from "./category.router.js";
import ProductRouter from "./product.router.js";
import CartRouter from "./cart.router.js";
import UserAddressRouter from "./user_address.router.js";
import OrderRouter from "./order.router.js";
import PaymentRouter from "./payment.router.js";
import MoMoRouter from "./momo.router.js";
import FeedbackRouter from "./feedback.router.js";
import ReviewRouter from "./review.outer.js";

const rootRoutes = express.Router();

rootRoutes.use("/QuanLyNguoiDung", userRouter);
rootRoutes.use("/QuanLyDanhMuc", CategoryRouter);
rootRoutes.use("/QuanLySanPham", ProductRouter);
rootRoutes.use("/QuanLyGioHang", CartRouter);
rootRoutes.use("/QuanLyGioHang", CartRouter);
rootRoutes.use("/QuanLyDiaChiGiaoHang", UserAddressRouter);
rootRoutes.use("/QuanLyDonHang", OrderRouter);
rootRoutes.use("/QuanLyThanhToan", PaymentRouter);
rootRoutes.use("/QuanLyGopY", FeedbackRouter);
rootRoutes.use("/MoMo", MoMoRouter);
rootRoutes.use("/QuanLyDanhGia", ReviewRouter);



export default rootRoutes;
