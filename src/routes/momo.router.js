
import express from "express";
import {
  updatePayment,
  handlePaymentRequest,
  retryPayment,
} from "../controllers/momo.controller.js";

const MoMotRouter = express.Router();

MoMotRouter.post("/callback-payment", updatePayment);
MoMotRouter.post("/checkout", handlePaymentRequest);
MoMotRouter.post("/retry-checkout", retryPayment);

export default MoMotRouter;
