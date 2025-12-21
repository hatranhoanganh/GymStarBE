import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";


import {
  getDashboardStatsToday,
  
} from "../controllers/dashboard.controller.js";

const DashboardRouter = express.Router();


DashboardRouter.get("/ThongKeBaoCaoTheoNgay", verifyToken, requireRole("Quản trị viên"), getDashboardStatsToday);

export default DashboardRouter;