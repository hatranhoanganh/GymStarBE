import express from "express";
import verifyToken from "../middleware/auth.middleware.js";
import {requireRole} from "../middleware/role.middleware.js";
import { addFeedback,
    getAllFeedbacks,
    deleteFeedback, 
    replyFeedback,
    getFeedbackUser,

 } from "../controllers/feedback.controller.js";

const FeedbackRouter = express.Router();


FeedbackRouter.post("/VietGopY",verifyToken, addFeedback);
FeedbackRouter.get("/LayDanhSachTatCaGopY",verifyToken,requireRole("Quản trị viên","Quản lý phản hồi","Khách hàng"), getAllFeedbacks);
FeedbackRouter.delete("/XoaGopY/:feedback_id",verifyToken,requireRole("Quản trị viên"), deleteFeedback);
FeedbackRouter.post("/TraLoiGopY/:feedback_id",verifyToken,requireRole("Quản trị viên","Quản lý phản hồi"), replyFeedback);
FeedbackRouter.get("/LayDanhSachGopYUser",verifyToken, getFeedbackUser);


export default FeedbackRouter;