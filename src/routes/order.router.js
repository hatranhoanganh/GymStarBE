import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import {
  placeCartOrder,
  placeDirectOrder,
  getOrdersByStatus,
  getOrderDetail,
  cancelOrder,
  getOrdersByKeyWord,
  getAllOrders,
  updateOrderStatus,
  reorderCart,
} from "../controllers/order.controller.js";

const OrderRouter = express.Router();

//chính mình
OrderRouter.post("/DatHangNgay",verifyToken, placeDirectOrder);
OrderRouter.post("/DatHangTuGioHang",verifyToken, placeCartOrder);
OrderRouter.post("/HuyDonHang/:order_id",verifyToken, cancelOrder);
OrderRouter.post("/MuaLai/:order_id",verifyToken, reorderCart);

//quản trị viên, quản lý đơn hàng và chính mình
OrderRouter.get("/LayDanhSachDonHangTheoTrangThai",verifyToken, getOrdersByStatus);
OrderRouter.get("/LayChiTietDonHang/:order_id",verifyToken, getOrderDetail);

//quản trị viên và quản lý đơn hàng
OrderRouter.get("/LayDanhSachDonHangTheoTuKhoa",verifyToken,
  requireRole("Quản trị viên", "Quản lý đơn hàng"), getOrdersByKeyWord);
OrderRouter.get("/LayDanhSachTatCaDonHang",verifyToken,
  requireRole("Quản trị viên", "Quản lý đơn hàng"), getAllOrders);
OrderRouter.put("/CapNhatTrangThaiDonHang/:order_id",verifyToken,
  requireRole("Quản trị viên", "Quản lý đơn hàng"), updateOrderStatus);




export default OrderRouter;
