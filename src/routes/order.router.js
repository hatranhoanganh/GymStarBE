import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import {
  placeCartOrder,
  placeDirectOrder,
  getOrderDetail,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
  reorderCart,
  getOrdersByStatus,
} from "../controllers/order.controller.js";

const OrderRouter = express.Router();

//chính mình
OrderRouter.post("/DatHangNgay",verifyToken, placeDirectOrder);
OrderRouter.post("/DatHangTuGioHang",verifyToken, placeCartOrder);
OrderRouter.post("/HuyDonHang/:order_id",verifyToken, cancelOrder);
OrderRouter.post("/MuaLai/:order_detail_id",verifyToken, reorderCart);

//quản trị viên, quản lý đơn hàng và chính mình
OrderRouter.get("/LayChiTietDonHang/:order_id",verifyToken, getOrderDetail);
OrderRouter.get("/LayDanhSachDonHangUser",verifyToken, getOrdersByStatus);

//quản trị viên và quản lý đơn hàng
OrderRouter.get("/LayDanhSachTatCaDonHang",verifyToken,
  requireRole("Quản trị viên", "Quản lý đơn hàng"), getAllOrders);
OrderRouter.put("/CapNhatTrangThaiDonHang/:order_id",verifyToken,
  requireRole("Quản trị viên", "Quản lý đơn hàng"), updateOrderStatus);




export default OrderRouter;