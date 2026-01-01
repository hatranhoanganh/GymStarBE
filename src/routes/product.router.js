import express from "express";
import upload from "../utils/multer.js";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import {
  addProductVariant,
  addSizeToVariant,
  getAllProducts,
  updateFullProduct,
  deleteProductVariant,
  getActiveProducts,
  getNewProductsLast2Days,
  getProductDetail,
  getProductByKeyWordAdmin,
  getProductByKeyWordUser,
  updateProductStatus,
  addFullProduct,
  getProductsByStatus,
  deleteProduct,
  getProductByCategory,
  deleteSize,
} from "../controllers/product.controller.js";


const ProductRouter = express.Router();
const handleUpload = (req, res, action) => {
  upload(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File vượt quá 100MB" });
      }
      return res.status(400).json({ message: err.message });
    }
    action(req, res);
  });
};


//quản trị viên và quản lý sản phẩm
ProductRouter.post(
  "/TaoSanPhamFull",
  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),
  (req, res) => handleUpload(req, res, addFullProduct)
);
ProductRouter.post(
  "/ThemBienThe/:product_id",
  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),
  (req, res) => handleUpload(req, res, addProductVariant)
);

ProductRouter.put(
  "/CapNhatSanPham/:product_id",
  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),
  (req, res) => handleUpload(req, res, updateFullProduct)
);
ProductRouter.post("/ThemSize/:product_id/:color",  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),addSizeToVariant);

ProductRouter.get("/LayTatCaSanPhamAdmin",  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),getAllProducts);
ProductRouter.get(
  "/LayDanhSachSanPhamTheoTuKhoaAdmin", verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),
  getProductByKeyWordAdmin
);

ProductRouter.put("/CapNhatTrangThaiSanPham/:product_id",  verifyToken,
  requireRole("Quản trị viên"),updateProductStatus);
ProductRouter.get("/LayDanhSachSanPhamTheoTrangThai",  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),getProductsByStatus);
ProductRouter.delete("/XoaSanPham/:product_id",  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),deleteProduct);
  ProductRouter.delete("/XoaBienThe/:product_id/:color",  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),deleteProductVariant);
    ProductRouter.delete("/XoaSize/:product_variant_id",  verifyToken,
  requireRole("Quản trị viên", "Quản lý sản phẩm"),deleteSize);

//không cần phân quyền
ProductRouter.get("/LayTatCaSanPhamUser", getActiveProducts);
ProductRouter.get("/LayTatCaSanPhamMoiTao2Ngay", getNewProductsLast2Days);
ProductRouter.get("/LayChiTietSanPham/:product_id", getProductDetail);
ProductRouter.get("/LayDanhSachSanPhamTheoTuKhoaUser", getProductByKeyWordUser);
ProductRouter.get("/LaySanPhamTheoDanhMuc/:category_id", getProductByCategory);


export default ProductRouter;
