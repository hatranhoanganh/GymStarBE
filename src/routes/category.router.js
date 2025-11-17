import express from "express";

import {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryByKeyWord,
    getCategoryCap1,
    getCategoryCap3LocCap1,
} from "../controllers/category.controller.js";

const CategoryRouter = express.Router();

CategoryRouter.get("/LayDanhSachDanhMuc", getAllCategories);
CategoryRouter.post("/TaoDanhMuc", createCategory);
CategoryRouter.put("/CapNhatDanhMuc/:id", updateCategory);
CategoryRouter.delete("/XoaDanhMuc/:id", deleteCategory);
CategoryRouter.get("/LayDanhSachDanhMucTheoTuKhoa", getCategoryByKeyWord);
CategoryRouter.get("/LayDanhMucCap1", getCategoryCap1);
CategoryRouter.get("/LayDanhMucCap3LocCap1", getCategoryCap3LocCap1);

export default CategoryRouter;
