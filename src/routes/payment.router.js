import express from "express";

import { getAllPayments,



 } from "../controllers/payment.controller.js";
 

const PaymentRouter = express.Router();


PaymentRouter.get("/LayDanhSachTatCaThanhToan", getAllPayments);
// CartRouter.put("/CapNhatSoLuongGioHang1/:user_id", updateCartQuantity);
// CartRouter.put("/CapNhatSoLuongGioHang2/:user_id", setCartQuantity);
// CartRouter.delete("/XoaSanPhamKhoiGioHang/:user_id", deleteCartItem);
// CartRouter.delete("/XoaNhieuSanPhamKhoiGioHang/:user_id", deleteMultipleCartItems);






export default PaymentRouter;