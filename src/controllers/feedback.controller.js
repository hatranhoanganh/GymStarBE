import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { Op, Sequelize } from "sequelize";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

import { formatVNDateTime } from "../utils/dateFormat.js";
dotenv.config();
const model = initModels(sequelize);

const addFeedback = async (req, res) => {
  try {
    const user_id = req.user.user_id;
    const { type, message } = req.body;

    if (!type || !message) {
      return res.status(400).json({ message: "Thiếu type hoặc message" });
    }

    const validTypes = [
      "Khen ngợi",
      "Đề xuất",
      "Khiếu nại",
      "Câu hỏi",
      "Góp ý về sản phẩm",
      "Góp ý về dịch vụ",
      "Khác",
    ];

    if (!validTypes.includes(type)) {
      return res.status(400).json({
        message: "Loại góp ý không hợp lệ",
        validTypes,
      });
    }

    // Validate message
    const cleanMsg = message.trim();

    if (cleanMsg.length < 5 || cleanMsg.length > 1000) {
      return res
        .status(400)
        .json({ message: "Nội dung góp ý chỉ từ 5 - 1000 kí tự" });
    }

    const lastFeedback = await model.feedbacks.findOne({
      where: { user_id },
      order: [["created_at", "DESC"]],
    });

    if (lastFeedback) {
      const diff = Date.now() - new Date(lastFeedback.createdAt).getTime();
      if (diff < 60 * 1000) {
        return res.status(429).json({
          message: "Bạn gửi góp ý quá nhanh, vui lòng thử lại sau 1 phút.",
        });
      }
    }

    // Create feedback
    const fb = await model.feedbacks.create({
      user_id,
      type,
      message: cleanMsg,
      createdAt: new Date(),
    });

    const user = await model.users.findByPk(user_id, {
      attributes: ["user_id", "full_name", "email", "role_id"],
      include: [{ model: model.roles, as: "role", attributes: ["role_name"] }],
    });

    return res.status(201).json({
      message: "Gửi góp ý thành công",
      data: {
        feedback_id: fb.feedback_id,
        type: fb.type,
        message: fb.message,
        createdAt: formatVNDateTime(fb.created_at),
        user: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          role_id: user.role_id,
          role_name: user.role?.role_name || null,
        },
      },
    });
  } catch (error) {
    console.error("addFeedback error:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const getAllFeedbacks = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const userRole = req.user.role_name?.toLowerCase();
    const userId = req.user.user_id;

   
    const whereCondition = userRole === "khách hàng" ? { user_id: userId } : {};


    const count = await model.feedbacks.count({ where: whereCondition });
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Không có góp ý nào.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

  
    const feedbacks = await model.feedbacks.findAll({
      where: whereCondition,
      attributes: ["feedback_id", "type", "message", "created_at"],
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "role_id"],
          include: [
            {
              model: model.roles,
              as: "role",
              attributes: ["role_name"],
            },
          ],
        },
        {
          model: model.feedback_reply,
          as: "feedback_reply", 
          include: [
            {
              model: model.users,
              as: "user",
              attributes: ["user_id", "full_name", "email"],
            },
          ],
        },
      ],
      limit: pageSize,
      offset,
      order: [["feedback_id", "DESC"]],
    });


    const formattedData = feedbacks.map((fb) => ({
      feedback: {
        feedback_id: fb.feedback_id,
        type: fb.type,
        message: fb.message,
        created_at: formatVNDateTime(fb.created_at),
        user: fb.user
          ? {
              user_id: fb.user.user_id,
              full_name: fb.user.full_name,
              email: fb.user.email,
            }
          : null,
      },
      reply: fb.feedback_reply
        ? {
            feedback_reply_id: fb.feedback_reply.feedback_reply_id,
            message: fb.feedback_reply.message,
            replied_at: formatVNDateTime(fb.feedback_reply.replied_at),
            admin: fb.feedback_reply.user
              ? {
                  user_id: fb.feedback_reply.user.user_id,
                  full_name: fb.feedback_reply.user.full_name,
                  email: fb.feedback_reply.user.email,
                }
              : null,
          }
        : null,
    }));

    return res.status(200).json({
      message: "Lấy danh sách góp ý thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getAllFeedbacks:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};



const deleteFeedback = async (req, res) => {
  try {
    const { feedback_id } = req.params;

    const feedback = await model.feedbacks.findByPk(feedback_id);
    if (!feedback) {
      return res.status(404).json({ message: "Góp ý không tồn tại" });
    }

    const reply = await model.feedback_reply.findOne({
      where: { feedback_id },
    });

    if (reply) {
      return res.status(400).json({
        message: "Không thể xóa. Góp ý này đã được phản hồi.",
      });
    }

    await model.feedbacks.destroy({ where: { feedback_id } });

    return res.status(200).json({
      message: "Xóa góp ý thành công",
      feedback_id,
    });
  } catch (error) {
    console.error("deleteFeedback error:", error.message);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const getFeedbackByKeyWord = async (req, res) => {
  try {
    let { keyword = "", page = 1, limit = 10 } = req.query;
    keyword = keyword.trim();
    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;
    const searchTerm = `%${keyword}%`;

    const searchCondition = {
      [Op.or]: [
        Sequelize.where(Sequelize.col("user.user_id"), {
          [Op.eq]: Number(keyword) || 0,
        }),
        Sequelize.where(
          Sequelize.fn("unaccent", Sequelize.col("user.email")),
          { [Op.iLike]: Sequelize.fn("unaccent", searchTerm) }
        ),
        Sequelize.where(
          Sequelize.fn("unaccent", Sequelize.col("user.full_name")),
          { [Op.iLike]: Sequelize.fn("unaccent", searchTerm) }
        ),
      ],
    };

    const total = await model.feedbacks.count({
      include: [
        {
          model: model.users,
          as: "user",
          attributes: [],
          where: searchCondition,
        },
      ],
    });

    if (total === 0) {
      return res.status(200).json({
        message: "Không tìm thấy góp ý phù hợp",
        data: [],
        pagination: { total: 0, page: 1, limit: pageSize, totalPages: 0 },
      });
    }

    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;

    const feedbacks = await model.feedbacks.findAll({
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "role_id"],
          where: searchCondition,
          include: [
            {
              model: model.roles,
              as: "role",
              attributes: ["role_name"],
            },
          ],
        },
        {
          model: model.feedback_reply,
          as: "feedback_reply",
          include: [
            {
              model: model.users,
              as: "user",
              attributes: ["user_id", "full_name", "email"],
            },
          ],
        },
      ],
      limit: pageSize,
      offset,
      order: [["feedback_id", "DESC"]],
    });

    const formattedData = feedbacks.map((fb) => ({
      feedback: {
        feedback_id: fb.feedback_id,
        type: fb.type,
        message: fb.message,
        created_at: formatVNDateTime(fb.created_at),
        user: fb.user
          ? {
              user_id: fb.user.user_id,
              full_name: fb.user.full_name,
              email: fb.user.email,
            }
          : null,
      },
      reply: fb.feedback_reply
        ? {
            feedback_reply_id: fb.feedback_reply.feedback_reply_id,
            message: fb.feedback_reply.message,
            replied_at: formatVNDateTime(fb.feedback_reply.replied_at),
            admin: fb.feedback_reply.user
              ? {
                  user_id: fb.feedback_reply.user.user_id,
                  full_name: fb.feedback_reply.user.full_name,
                  email: fb.feedback_reply.user.email,
                }
              : null,
          }
        : null,
    }));

    return res.status(200).json({
      message: "Tìm kiếm góp ý thành công",
      total,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi searchFeedback:", error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};

const replyFeedback = async (req, res) => {
  let t;
  try {
    t = await sequelize.transaction();

    const { feedback_id } = req.params;
    const { message } = req.body;
    const reply_id = req.user.user_id;

    if (!message?.trim()) {
      return res
        .status(400)
        .json({ message: "Nội dung trả lời không được để trống" });
    }

    const feedback = await model.feedbacks.findOne({
      where: { feedback_id },
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email"],
        },
      ],
      transaction: t,
    });

    if (!feedback) {
      return res.status(404).json({ message: "Góp ý không tồn tại" });
    }

    const existedReply = await model.feedback_reply.findOne({
      where: { feedback_id },
      transaction: t,
    });

    if (existedReply) {
      return res.status(400).json({ message: "Góp ý này đã được trả lời ròi" });
    }

    const reply = await model.feedback_reply.create(
      {
        feedback_id,
        user_id: reply_id,
        message: message.trim(),
      },
      { transaction: t }
    );

    const admin = await model.users.findByPk(reply_id, {
      attributes: ["user_id", "full_name", "email"],
      transaction: t,
    });

    await t.commit();

    return res.status(200).json({
      message: "Trả lời góp ý thành công",
      data: {
        feedback: {
          feedback_id: feedback.feedback_id,
          message: feedback.message,
          created_at: formatVNDateTime(feedback.created_at),
          user: {
            user_id: feedback.user.user_id,
            full_name: feedback.user.full_name,
            email: feedback.user.email,
          },
        },
        reply: {
          feedback_reply_id: reply.feedback_reply_id,
          message: reply.message,
          replied_at: formatVNDateTime(reply.replied_at),
          admin: {
            user_id: admin.user_id,
            full_name: admin.full_name,
            email: admin.email,
          },
        },
      },
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error("Lỗi replyFeedback:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const getFeedbackUser = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    if (!user_id) {
      return res.status(401).json({
        message: "Không tìm thấy thông tin người dùng",
      });
    }

    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

 
    const whereCondition = { user_id };

    const count = await model.feedbacks.count({ where: whereCondition });
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Bạn chưa có góp ý nào.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;

    const feedbacks = await model.feedbacks.findAll({
      where: whereCondition,
      attributes: ["feedback_id", "type", "message", "created_at"],
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email"],
        },
        {
          model: model.feedback_reply,
          as: "feedback_reply",
          include: [
            {
              model: model.users,
              as: "user",
              attributes: ["user_id", "full_name", "email"],
            },
          ],
        },
      ],
      limit: pageSize,
      offset,
      order: [["feedback_id", "DESC"]],
    });

    const formattedData = feedbacks.map((fb) => ({
      feedback: {
        feedback_id: fb.feedback_id,
        type: fb.type,
        message: fb.message,
        created_at: formatVNDateTime(fb.created_at),
        user: fb.user
          ? {
              user_id: fb.user.user_id,
              full_name: fb.user.full_name,
              email: fb.user.email,
            }
          : null,
      },
      reply: fb.feedback_reply
        ? {
            feedback_reply_id: fb.feedback_reply.feedback_reply_id,
            message: fb.feedback_reply.message,
            replied_at: formatVNDateTime(fb.feedback_reply.replied_at),
            admin: fb.feedback_reply.user
              ? {
                  user_id: fb.feedback_reply.user.user_id,
                  full_name: fb.feedback_reply.user.full_name,
                  email: fb.feedback_reply.user.email,
                }
              : null,
          }
        : null,
    }));

    return res.status(200).json({
      message: "Lấy danh sách góp ý của bạn thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getMyFeedbacks:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export {
  addFeedback,
  getAllFeedbacks,
  deleteFeedback,
  getFeedbackByKeyWord,
  replyFeedback,
  getFeedbackUser,
};
