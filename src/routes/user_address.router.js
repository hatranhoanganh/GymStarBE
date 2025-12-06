import express from "express";

import { addAddress,
updateAddress,
deleteAddress,
setDefaultAddress,
getAllUserAddresses,
getUserAddressesById,
getUserAddressesByKeyWord,

 } from "../controllers/user_address.controller.js";

const UserAddressRouter = express.Router();

UserAddressRouter.post("/ThemDiaChi", addAddress);
UserAddressRouter.put("/CapNhatDiaChi/:user_id", updateAddress);
UserAddressRouter.put("/ChonDiaChiMacDinh/:user_id", setDefaultAddress);
UserAddressRouter.delete("/XoaDiaChi/:user_id", deleteAddress);
UserAddressRouter.get("/LayDanhSachDiaChi/:user_id", getUserAddressesById);
UserAddressRouter.get("/LayDanhSachTatCaDiaChi", getAllUserAddresses);
UserAddressRouter.get("/LayDanhSachDiaChiTheoTuKhoa",getUserAddressesByKeyWord);






export default UserAddressRouter;