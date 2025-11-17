import express from "express";

import {
  getAllUsers,
  registerUser,
  verifyEmail,
  loginUser,
  refreshTokenRoute,
  getUserById,
  disableUser,
  enableUser,
  getUserByKeyWordOrStatus,
  updateUser,
  changePassword,
  forgotPassword,
  verifyOTP,
  resetPassword
} from "../controllers/user.controller.js";
import { forgotPasswordLimiter } from "../middleware/rateLimit.js";

const userRouter = express.Router();

userRouter.get("/LayDanhSachNguoiDung", getAllUsers);
userRouter.post("/DangKy", registerUser);
userRouter.get("/verify-email", verifyEmail);
userRouter.post("/DangNhap", loginUser);
userRouter.post("/refresh-token", refreshTokenRoute);
userRouter.get("/LayThongTinNguoiDung/:id", getUserById);
userRouter.put("/VoHieuHoaTaiKhoan/:id", disableUser);
userRouter.put("/KichHoatLaiTaiKhoan/:id", enableUser);
userRouter.put("/CapNhatThongTin/:id", updateUser);
userRouter.get("/LayThongTinTaiKhoanTheoKeyWordHoacStatus",  getUserByKeyWordOrStatus);
userRouter.put("/DoiMatKhau/:id", changePassword);
userRouter.post("/QuenMatKhau", forgotPasswordLimiter, forgotPassword);
userRouter.post("/verify-otp", verifyOTP);
userRouter.put("/DatLaiMatKhau", resetPassword);


export default userRouter;
