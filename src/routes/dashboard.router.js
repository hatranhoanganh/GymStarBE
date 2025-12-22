import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";


import {
  getDashboardStatsToday,getTopProductsThisMonth,getRevenueByDateRange
  
} from "../controllers/dashboard.controller.js";

const DashboardRouter = express.Router();


DashboardRouter.get("/ThongKeBaoCaoTheoNgay", verifyToken, requireRole("Quản trị viên"), getDashboardStatsToday);
DashboardRouter.get("/ThongKeSanPhamBanChay", verifyToken, requireRole("Quản trị viên"), getTopProductsThisMonth);
DashboardRouter.get("/ThongKeTongDoanhThuTheoThang", verifyToken, requireRole("Quản trị viên"), getRevenueByDateRange);

export default DashboardRouter;