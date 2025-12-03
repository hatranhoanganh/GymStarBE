import express from "express";
import upload from "../utils/multer.js";
import {
  addProductVariant,
  addSizeToVariant,
  getProductByDanhMucCap1,
  getAllProducts,
  updateFullProduct,
  getActiveProducts,
  getProductDetail,
  getProductByKeyWordAdmin,
  getProductByKeyWordUser,
  updateProductStatus,
  addFullProduct,
  getProductsByStatus,
} from "../controllers/product.controller.js";
import { get } from "http";

const ProductRouter = express.Router();
const handleUpload = (req, res, next, action) => {
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

ProductRouter.post("/TaoSanPhamFull", (req, res) => {
  handleUpload(req, res, null, addFullProduct);
});
ProductRouter.post("/ThemBienThe/:product_id", (req, res) => {
  handleUpload(req, res, null, addProductVariant);
});
ProductRouter.put("/CapNhatSanPham/:product_id", (req, res) => {
  handleUpload(req, res, null, updateFullProduct);
});
ProductRouter.post("/ThemSize/:product_id/:color", addSizeToVariant);
ProductRouter.get(
  "/LaySanPhamTheoDanhMucCap1/:root_id",
  getProductByDanhMucCap1
);
ProductRouter.get("/LayTatCaSanPhamAdmin", getAllProducts);
ProductRouter.get("/LayTatCaSanPhamUser", getActiveProducts);
ProductRouter.get("/LayChiTietSanPham/:product_id", getProductDetail);
ProductRouter.get(
  "/LayDanhSachSanPhamTheoTuKhoaAdmin",
  getProductByKeyWordAdmin
);
ProductRouter.get("/LayDanhSachSanPhamTheoTuKhoaUser", getProductByKeyWordUser);
ProductRouter.put("/CapNhatTrangThaiSanPham/:id", updateProductStatus);
ProductRouter.get("/LayDanhSachSanPhamTheoTrangThai", getProductsByStatus);

export default ProductRouter;
