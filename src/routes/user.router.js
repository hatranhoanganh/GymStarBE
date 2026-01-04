import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRoleExcept,requireRole} from "../middleware/role.middleware.js";
import {
  getAllUsers,
  registerUser,
  verifyEmail,
  loginUser,
  getUserById,
  updateUser,
  changePassword,
  forgotPassword,
  verifyOTP,
  resetPassword,
  updateStatus,
  assignUserRole, 
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
} from "../controllers/user.controller.js";
import { forgotPasswordLimiter } from "../middleware/rateLimit.js";

const userRouter = express.Router();
//trừ khách hàng
userRouter.get("/LayDanhSachNguoiDung", verifyToken,requireRoleExcept("Khách hàng"),getAllUsers);


//không cần phân quyền
userRouter.post("/DangKy", registerUser);
userRouter.get("/verify-email", verifyEmail);
userRouter.post("/DangNhap", loginUser);
userRouter.post("/QuenMatKhau", forgotPasswordLimiter, forgotPassword);
userRouter.post("/verify-otp", verifyOTP);
userRouter.put("/DatLaiMatKhau", resetPassword);  

//chính mình
userRouter.get("/LayThongTinNguoiDung",verifyToken, getUserById);
userRouter.put("/CapNhatThongTin", verifyToken, updateUser);
userRouter.put("/DoiMatKhau",verifyToken, changePassword);

//quản trị viên 
userRouter.put("/CapNhatTrangThai/:user_id",verifyToken,requireRole("Quản trị viên"), updateStatus);
userRouter.put("/PhanQuyenRole/:user_id", verifyToken,requireRole("Quản trị viên"),  assignUserRole);
userRouter.get("/LayDanhSachRole",verifyToken,requireRole("Quản trị viên"), getAllRoles);
userRouter.post("/TaoRole",verifyToken,requireRole("Quản trị viên"), createRole);
userRouter.put("/CapNhatRole/:role_id",verifyToken,requireRole("Quản trị viên"), updateRole);
userRouter.delete("/XoaRole/:role_id",verifyToken,requireRole("Quản trị viên"), deleteRole);







export default userRouter;
