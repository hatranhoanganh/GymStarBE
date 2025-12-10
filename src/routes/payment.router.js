import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import { getAllPayments,



 } from "../controllers/payment.controller.js";
 

const PaymentRouter = express.Router();

//quản trị viên và quản lý đơn hàng
PaymentRouter.get("/LayDanhSachTatCaThanhToan", verifyToken,requireRole("Quản trị viên", "Quản lý đơn hàng"), getAllPayments);






export default PaymentRouter;