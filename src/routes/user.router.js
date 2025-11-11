import express from "express";

import {
  getAllUsers,
  registerUser,
  verifyEmail,
  loginUser,
  refreshTokenRoute,
} from "../controllers/user.controller.js";

const userRouter = express.Router();

userRouter.get("/LayDanhSachNguoiDung", getAllUsers);
userRouter.post("/DangKy", registerUser);
userRouter.get("/verify-email", verifyEmail);
userRouter.post("/DangNhap", loginUser);
userRouter.post("/refresh-token", refreshTokenRoute);

export default userRouter;
