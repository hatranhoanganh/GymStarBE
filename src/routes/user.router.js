import express from "express";

import {
  getAllUsers,
  registerUser,
  verifyEmail,
  loginUser,
  refreshTokenRoute,
  getUserById,
  updateUser,
  changePassword,
  forgotPassword,
  verifyOTP,
  resetPassword,
  updateStatus,
  getUserByKeyword,
  getUsersByStatus,
  assignUserRole
} from "../controllers/user.controller.js";
import { forgotPasswordLimiter } from "../middleware/rateLimit.js";

const userRouter = express.Router();

userRouter.get("/LayDanhSachNguoiDung", getAllUsers);
userRouter.post("/DangKy", registerUser);
userRouter.get("/verify-email", verifyEmail);
userRouter.post("/DangNhap", loginUser);
userRouter.post("/refresh-token", refreshTokenRoute);
userRouter.get("/LayThongTinNguoiDung/:id", getUserById);
userRouter.put("/CapNhatTrangThai/:id", updateStatus);
userRouter.put("/CapNhatThongTin/:id", updateUser);
userRouter.get("/LayThongTinTaiKhoanTheoKeyWord",  getUserByKeyword);
userRouter.get("/LayThongTinTaiKhoanTheoStatus",  getUsersByStatus);
userRouter.put("/DoiMatKhau/:id", changePassword);
userRouter.post("/QuenMatKhau", forgotPasswordLimiter, forgotPassword);
userRouter.post("/verify-otp", verifyOTP);
userRouter.put("/DatLaiMatKhau", resetPassword);
userRouter.put("/PhanQuyenRole/:user_id", assignUserRole);


export default userRouter;
