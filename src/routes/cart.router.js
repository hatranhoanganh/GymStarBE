import express from "express";

import { addToCart,
decreaseCartItem,
getCart,


 } from "../controllers/cart.controller.js";

const CartRouter = express.Router();

CartRouter.post("/ThemSanPhamVaoGioHang/:user_id", addToCart);
CartRouter.put("/GiamSoLuongSanPhamTrongGioHang/:user_id", decreaseCartItem);
CartRouter.get("/XemGioHang/:user_id", getCart);





export default CartRouter;