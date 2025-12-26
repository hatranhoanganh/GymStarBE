
import express from "express";
import {
  updatePayment,
  retryPayment,
} from "../controllers/momo.controller.js";

const MoMotRouter = express.Router();

MoMotRouter.post("/callback-payment", updatePayment);
MoMotRouter.post("/retry-checkout", retryPayment);

export default MoMotRouter;
