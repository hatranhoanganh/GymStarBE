import express from "express";

import {
  placeCartOrder,
  placeDirectOrder,
  getOrdersByStatus,
  getOrderDetail,
  cancelOrder,
  getOrdersByKeyWord,
  getAllOrders,
  updateOrderStatus,
} from "../controllers/order.controller.js";

const OrderRouter = express.Router();

OrderRouter.post("/DatHangNgay/:user_id", placeDirectOrder);
OrderRouter.post("/DatHangTuGioHang/:user_id", placeCartOrder);
OrderRouter.get("/LayDanhSachDonHangTheoTrangThai", getOrdersByStatus);
OrderRouter.get("/LayChiTietDonHang/:order_id", getOrderDetail);
OrderRouter.post("/HuyDonHang/:order_id", cancelOrder);
OrderRouter.get("/LayDanhSachDonHangTheoTuKhoa", getOrdersByKeyWord);
OrderRouter.get("/LayDanhSachTatCaDonHang", getAllOrders);
OrderRouter.put("/CapNhatTrangThaiDonHang/:order_id", updateOrderStatus);
// CartRouter.delete("/XoaSanPhamKhoiGioHang/:user_id", deleteCartItem);
// CartRouter.delete("/XoaNhieuSanPhamKhoiGioHang/:user_id", deleteMultipleCartItems);

export default OrderRouter;
