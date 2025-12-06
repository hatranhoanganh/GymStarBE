import express from "express";

import { addToCart,
getCart,
setCartQuantity,
updateCartQuantity,
deleteCartItem,
deleteMultipleCartItems,


 } from "../controllers/cart.controller.js";

const CartRouter = express.Router();

CartRouter.post("/ThemSanPhamVaoGioHang/:user_id", addToCart);
CartRouter.get("/XemGioHang/:user_id", getCart);
CartRouter.put("/CapNhatSoLuongGioHang1/:user_id", updateCartQuantity);
CartRouter.put("/CapNhatSoLuongGioHang2/:user_id", setCartQuantity);
CartRouter.delete("/XoaSanPhamKhoiGioHang/:user_id", deleteCartItem);
CartRouter.delete("/XoaNhieuSanPhamKhoiGioHang/:user_id", deleteMultipleCartItems);






export default CartRouter;