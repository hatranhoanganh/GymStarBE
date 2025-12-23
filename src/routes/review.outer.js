import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import upload from "../utils/multer.js";
import { createReview, 
  replyReview, 
  getReviewsByProduct,
  toggleReviewVisibility,
  getAllReviews,
getReviewDetailByOrder,
getReviewsByUser,
 } from "../controllers/review.controller.js";

const ReviewRouter = express.Router();
const handleUpload = (req, res, action) => {
  upload(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File vượt quá 5MB" });
      }
      return res.status(400).json({ message: err.message });
    }
    action(req, res);
  });
};

ReviewRouter.post(
  "/VietDanhGia",
  verifyToken,
  (req, res) => handleUpload(req, res, createReview)
);


ReviewRouter.post("/TraLoiDanhGia", verifyToken,requireRole("Quản trị viên","Quản lý phản hồi"), replyReview);
ReviewRouter.put("/CapNhatTrangThaiDanhGia/:review_id", verifyToken,requireRole("Quản trị viên","Quản lý phản hồi"), toggleReviewVisibility);
ReviewRouter.get("/LayDanhSachDanhGiaCuaSanPham/:product_id",  getReviewsByProduct);
ReviewRouter.get("/LayDanhSachTatCaDanhGia",verifyToken,requireRole("Quản trị viên","Quản lý phản hồi"),  getAllReviews);
ReviewRouter.get("/LayDanhGiaCuaChiTietDonHang/:order_detail_id",verifyToken,  getReviewDetailByOrder);
ReviewRouter.get("/LayDanhGiaCuaNguoiDung",verifyToken,  getReviewsByUser);



export default ReviewRouter;