import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import { addAddress,
updateAddress,
deleteAddress,
setDefaultAddress,
getAllUserAddresses,
getUserAddressesById,
getUserAddressesByKeyWord,

 } from "../controllers/user_address.controller.js";

const UserAddressRouter = express.Router();


UserAddressRouter.post("/ThemDiaChi",verifyToken, addAddress);
UserAddressRouter.put("/CapNhatDiaChi/:address_id",verifyToken, updateAddress);
UserAddressRouter.put("/ChonDiaChiMacDinh/:address_id",verifyToken, setDefaultAddress);
UserAddressRouter.delete("/XoaDiaChi/:address_id",verifyToken, deleteAddress);
UserAddressRouter.get("/LayDanhSachDiaChi",verifyToken, getUserAddressesById);

//quản trị viên và quản lý đơn hàng
UserAddressRouter.get("/LayDanhSachTatCaDiaChi",verifyToken,requireRole("Quản trị viên","Quản lý đơn hàng"), getAllUserAddresses);
UserAddressRouter.get("/LayDanhSachDiaChiTheoTuKhoa",verifyToken,requireRole("Quản trị viên","Quản lý đơn hàng"),getUserAddressesByKeyWord);






export default UserAddressRouter;