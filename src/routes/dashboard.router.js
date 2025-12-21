import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";


import {
  getDashboardStats,
  
} from "../controllers/dashboard.controller.js";

const DashboardRouter = express.Router();

DashboardRouter.get("/ThongKeBaoCao", verifyToken, requireRole("Quản trị viên"), getDashboardStats);

export default DashboardRouter;