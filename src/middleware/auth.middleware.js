
import jwt from "jsonwebtoken";
import initModels from "../models/init-models.js";
import sequelize from "../config/database.js"; 
import asyncHandler from "./asyncHandler.js";

const model = initModels(sequelize); 
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Không có token" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Token không hợp lệ" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await model.users.findByPk(decoded.user_id, {
      include: [{ model: model.roles, as: "role", attributes: ["role_name"] }],
      attributes: ["user_id", "status", "role_id"],
    });

    if (!user) {
      return res.status(401).json({ message: "User không tồn tại" });
    }

    if (user.status !== "đang hoạt động") {
      return res.status(403).json({ message: "Tài khoản bị khóa hoặc chưa xác minh" });
    }

    req.user = {
      user_id: user.user_id,
      role_id: user.role_id,
      role_name: user.role?.role_name || "Khách hàng",
    };

    next();
  } catch (err) {
    console.error("verifyToken error:", err.message);
    return res.status(401).json({ 
      message: "Token không hợp lệ hoặc đã hết hạn",
      error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
  }
};

export default asyncHandler(verifyToken);