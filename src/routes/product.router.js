import express from "express";
import upload from "../utils/multer.js";
import {
  addProduct,
  addProductVariant,
  addSizeToVariant,
  getProductByDanhMucCap1,
  getAllProducts,
  getProductVariants,
  updateProduct,
  updateProductVariant,
  getActiveProducts,
    getProductByKeyWordAdmin,
    getProductByKeyWordUser,
    addThumbnailProduct,
    addImageProductByColor,
    getProductDetailAdmin,
    getProductDetailUser,
    updateProductStatus,
    updateThumbnailProduct,
    updateImagesProductByColor,
} from "../controllers/product.controller.js";

const ProductRouter = express.Router();

ProductRouter.post("/TaoSanPham", addProduct);
ProductRouter.post("/ThemBienThe/:id", addProductVariant);
ProductRouter.post("/ThemSize/:id/:color", addSizeToVariant);
ProductRouter.get("/LaySanPhamTheoDanhMucCap1", getProductByDanhMucCap1);
ProductRouter.get("/LayTatCaSanPhamAdmin", getAllProducts);
ProductRouter.get("/LayBienTheSanPham/:id", getProductVariants);
ProductRouter.put("/CapNhatSanPham/:id", updateProduct);
ProductRouter.put("/CapNhatBienThe/:id", updateProductVariant);
ProductRouter.get("/LayTatCaSanPhamUser", getActiveProducts);
ProductRouter.get("/LayDanhSachSanPhamTheoTuKhoaAdmin", getProductByKeyWordAdmin);
ProductRouter.get("/LayDanhSachSanPhamTheoTuKhoaUser", getProductByKeyWordUser);
ProductRouter.post("/ThemAnhSanPham/:product_id", upload.single("thumbnail"), addThumbnailProduct);
ProductRouter.post("/ThemAnhSanPhamTheoMau/:product_id", upload.array("images"), addImageProductByColor);
ProductRouter.get("/ChiTietSanPhamAdmin/:product_id", getProductDetailAdmin);
ProductRouter.get("/ChiTietSanPhamUser/:product_id", getProductDetailUser);
ProductRouter.put("/CapNhatTrangThaiSanPham/:id", updateProductStatus);
ProductRouter.put("/CapNhatAnhSanPham/:product_id",upload.single("thumbnail"), updateThumbnailProduct);
ProductRouter.put("/CapNhatAnhTheoMau/:product_id", upload.array("images"), updateImagesProductByColor);






export default ProductRouter;
