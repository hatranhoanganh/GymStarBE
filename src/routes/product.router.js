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
  hideProduct,
  getActiveProducts,
    unhideProduct,
    getProductByKeyWordAdmin,
    getProductByKeyWordUser,
    addThumbnailProduct,
    addImageVariant,
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
ProductRouter.put("/AnSanPham/:id", hideProduct);
ProductRouter.put("/HienSanPham/:id", unhideProduct);
ProductRouter.get("/LayTatCaSanPhamUser", getActiveProducts);
ProductRouter.get("/LayDanhSachSanPhamTheoTuKhoaAdmin", getProductByKeyWordAdmin);
ProductRouter.get("/LayDanhSachSanPhamTheoTuKhoaUser", getProductByKeyWordUser);
ProductRouter.post("/ThemAnhSanPham", upload.single("thumbnail"), addThumbnailProduct);
ProductRouter.post("/ThemAnhBienThe", upload.array("images"), addImageVariant);


export default ProductRouter;
