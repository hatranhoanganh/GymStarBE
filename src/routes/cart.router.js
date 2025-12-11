import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import { addToCart,
getCart,
setCartQuantity,
deleteCartItem,
deleteMultipleCartItems,


 } from "../controllers/cart.controller.js";

const CartRouter = express.Router();

CartRouter.post("/ThemSanPhamVaoGioHang",verifyToken, addToCart);
CartRouter.get("/XemGioHang",verifyToken, getCart);

CartRouter.put("/CapNhatSoLuongGioHang2",verifyToken, setCartQuantity);
CartRouter.delete("/XoaSanPhamKhoiGioHang",verifyToken, deleteCartItem);
CartRouter.delete("/XoaNhieuSanPhamKhoiGioHang",verifyToken, deleteMultipleCartItems);






export default CartRouter;