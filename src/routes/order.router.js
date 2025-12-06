import express from "express";

import { placeCartOrder, placeDirectOrder,



 } from "../controllers/order.controller.js";

const OrderRouter = express.Router();

OrderRouter.post("/DatHangNgay/:user_id", placeDirectOrder);
OrderRouter.post("/DatHangTuGioHang/:user_id", placeCartOrder);
// CartRouter.get("/XemGioHang/:user_id", getCart);
// CartRouter.put("/CapNhatSoLuongGioHang1/:user_id", updateCartQuantity);
// CartRouter.put("/CapNhatSoLuongGioHang2/:user_id", setCartQuantity);
// CartRouter.delete("/XoaSanPhamKhoiGioHang/:user_id", deleteCartItem);
// CartRouter.delete("/XoaNhieuSanPhamKhoiGioHang/:user_id", deleteMultipleCartItems);






export default OrderRouter;