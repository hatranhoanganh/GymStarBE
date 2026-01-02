import express from "express";
import { chatbot } from "../controllers/chatbot.controller.js";

const ChatBotRouter = express.Router();

ChatBotRouter.post("/chatbot", chatbot);

export default ChatBotRouter;
