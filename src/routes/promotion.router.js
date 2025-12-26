import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import { 
createPromotion,
updatePromotion,
deletePromotion,
togglePromotionStatus,
getAllPromotions,
getActivePromotionsForUser,
 } from "../controllers/promotion.controller.js";

const PromotionRouter = express.Router();


PromotionRouter.post("/TaoKhuyenMai",verifyToken, requireRole("Quản trị viên"), createPromotion);
PromotionRouter.put("/CapNhatKhuyenMai/:promotion_id",verifyToken, requireRole("Quản trị viên"), updatePromotion);
PromotionRouter.delete("/XoaKhuyenMai/:promotion_id",verifyToken, requireRole("Quản trị viên"), deletePromotion);
PromotionRouter.put("/CapNhatTrangThaiKhuyenMai/:promotion_id",verifyToken, requireRole("Quản trị viên"), togglePromotionStatus);
PromotionRouter.get("/LayDanhSachKhuyenMaiAdmin",verifyToken, requireRole("Quản trị viên"), getAllPromotions);
PromotionRouter.get("/LayDanhSachKhuyenMaiUser",verifyToken, getActivePromotionsForUser);



export default PromotionRouter;