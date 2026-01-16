import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryCap3LocCap1,
} from "../controllers/category.controller.js";

const CategoryRouter = express.Router();

//quản trị viên và quản lý sản phẩm
CategoryRouter.post("/TaoDanhMuc",verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"), createCategory);
CategoryRouter.put("/CapNhatDanhMuc/:category_id",verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"), updateCategory);
CategoryRouter.delete("/XoaDanhMuc/:category_id",verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"), deleteCategory);

CategoryRouter.get("/LayDanhSachDanhMuc", getAllCategories);
CategoryRouter.get("/LayDanhMucCap3LocCap1/:root_id", getCategoryCap3LocCap1);

export default CategoryRouter;
