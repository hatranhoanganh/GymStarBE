import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import fs from "fs/promises";
import cloudinary from "../config/cloudinary.js";

import {
  formatVNDateTime,
} from "../utils/dateFormat.js";

dotenv.config();
const model = initModels(sequelize);

const createReview = async (req, res) => {
  const filesToDelete = new Set();

  const markForDeletion = (path) => {
    if (path && typeof path === "string") filesToDelete.add(path);
  };

  const cleanupAllTempFiles = async () => {
    if (filesToDelete.size === 0) return;
    for (const path of filesToDelete) {
      try {
        await fs.unlink(path);
      } catch (err) {
        if (err.code !== "ENOENT") console.error("Lỗi xóa file tạm:", path, err.message);
      }
    }
    filesToDelete.clear();
  };

  const sendError = async (msg) => {
    await cleanupAllTempFiles();
    return res.status(400).json({ message: msg });
  };

  let t;
  try {
    t = await sequelize.transaction();

    const { order_detail_id, rating, comment } = req.body;
    const images = req.files || [];
    const user_id = req.user.user_id;

    images.forEach((f) => markForDeletion(f.path));

    if (!order_detail_id || !rating) return sendError("Thiếu order_detail_id hoặc rating");
    if (comment && comment.length > 500) return sendError("Comment tối đa 500 ký tự");
    if (images.length > 5) return sendError("Chỉ được upload tối đa 5 ảnh");

   
    const orderDetail = await model.order_details.findOne({
      where: { order_detail_id },
      include: {
        model: model.orders,
        as: "order",
        where: { user_id },
        attributes: ["status"],
      },
    });

    if (!orderDetail) return sendError("Order detail không tồn tại hoặc không thuộc về bạn");

    if (!orderDetail.order || orderDetail.order.status !== "đã giao") {
      return sendError("Chỉ được đánh giá khi đơn hàng đã giao");
    }

    const existingReview = await model.reviews.findOne({ where: { order_detail_id } });
    if (existingReview) return sendError("Đơn hàng này đã được đánh giá");

    const review = await model.reviews.create(
      {
        order_detail_id,
        rating,
        comment: comment || null,
        is_visible: true,
      },
      { transaction: t }
    );

    let uploadedImages = [];
    if (images.length > 0) {
      const uploadPromises = images.map((img) =>
        cloudinary.uploader.upload(img.path, {
          folder: `reviews/${review.review_id}`,
          public_id: `img_${Date.now()}`,
          resource_type: "image",
        })
      );

      uploadedImages = await Promise.all(uploadPromises);

      for (const img of uploadedImages) {
        await model.review_images.create(
          {
            review_id: review.review_id,
            image: img.secure_url,
          },
          { transaction: t }
        );
      }
    }

    await t.commit();
    await cleanupAllTempFiles();

    const formattedReview = {
      review_id: review.review_id,
      order_detail_id: review.order_detail_id,
      rating: review.rating,
      comment: review.comment,
      is_visible: review.is_visible,
      createdAt: formatVNDateTime(review.created_at),
      images: uploadedImages.map((i) => i.secure_url),
    };

    return res.status(201).json({
      message: "Đánh giá thành công",
      review: formattedReview,
    });
  } catch (error) {
    if (t) await t.rollback();
    await cleanupAllTempFiles();
    console.error("Lỗi createReview:", error);
    return res.status(500).json({ message: "Có lỗi khi tạo review" });
  }
};


const replyReview = async (req, res) => {
  const { review_id, message } = req.body;
  const user_id = req.user.user_id; 

  if (!review_id || !message || message.trim() === "") {
    return res.status(400).json({ message: "Thiếu review_id hoặc message" });
  }

  let t;
  try {
    t = await sequelize.transaction();

  
    const review = await model.reviews.findByPk(review_id);
    if (!review) {
      return res.status(404).json({ message: "Review không tồn tại" });
    }

    
    const existingReply = await model.review_reply.findOne({
      where: { review_id }
    });
    if (existingReply) {
      return res.status(400).json({ message: "Đánh giá này đã được trả lời" });
    }

   
    const reply = await model.review_reply.create(
      {
        review_id,
        user_id,
        message: message.trim()
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      message: "Trả lời đánh giá thành công",
      reply: {
        review_reply_id: reply.review_reply_id,
        review_id: reply.review_id,
        user_id: reply.user_id,
        message: reply.message,
        replied_at: reply.replied_at
      }
    });
  } catch (error) {
    if (t) await t.rollback();
    console.error("Lỗi replyReview:", error);
    return res.status(500).json({ message: "Có lỗi khi trả lời đánh giá" });
  }
};

const getReviewsByProduct = async (req, res) => {
  try {
    const { product_id } = req.params;
    const { color, page = 1, limit = 10 } = req.query;

    if (!product_id) {
      return res.status(400).json({ message: "Thiếu product_id" });
    }

    const product = await model.products.findByPk(product_id);
    if (!product) {
      return res.status(404).json({
        message: "Sản phẩm không tồn tại",
      });
    }

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

   
    const variantWhere = { product_id };
    if (color) {
      variantWhere.color = color;
    }

   
    const { count: total } = await model.reviews.findAndCountAll({
      where: { is_visible: true },
      include: [
        {
          model: model.order_details,
          as: "order_detail",
          required: true,
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
              required: true,
              where: variantWhere,
            },
          ],
        },
      ],
      distinct: true,
    });

    if (total === 0) {
      return res.status(200).json({
        message: "Chưa có đánh giá nào.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;

    
    const { rows: reviews } = await model.reviews.findAndCountAll({
      where: { is_visible: true },
      include: [
        {
          model: model.order_details,
          as: "order_detail",
          required: true,
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
              required: true,
              where: variantWhere,
              attributes: ["product_variant_id", "color", "size"],
            },
            {
              model: model.orders,
              as: "order",
              attributes: ["order_id", "user_id", "status"],
              include: [
                {
                  model: model.users,
                  as: "user",
                  attributes: ["user_id", "full_name", "email", "gender"],
                },
              ],
            },
          ],
        },
        {
          model: model.review_images,
          as: "review_images",
          attributes: ["image"],
        },
        {
          model: model.review_reply,
          as: "review_reply",
          include: [
            {
              model: model.users,
              as: "user",
              attributes: ["user_id", "full_name", "email"],
            },
          ],
        },
      ],
      order: [["review_id", "DESC"]],
      limit: pageSize,
      offset,
      distinct: true,
    });

    const data = reviews.map((r) => ({
      review_id: r.review_id,
      rating: r.rating,
      comment: r.comment,
      createdAt: formatVNDateTime(r.createdAt),
      images: r.review_images.map((i) => i.image),
      variant: {
  color: r.order_detail.product_variant.color,
  size: r.order_detail.product_variant.size,
},
      reviewer: r.order_detail.order.user,
      reply: r.review_reply
        ? {
            message: r.review_reply.message,
            replied_at: formatVNDateTime(r.review_reply.replied_at),
            replier: r.review_reply.user,
          }
        : null,
    }));

    return res.status(200).json({
      message: "Lấy danh sách đánh giá thành công",
      total,
      page: validPage,
      totalPages,
      data,
    });
  } catch (error) {
    console.error("getReviewsByProduct error:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};




const toggleReviewVisibility = async (req, res) => {
  try {
    const { review_id } = req.params;

    if (!review_id)
      return res.status(400).json({ message: "Thiếu review_id" });

    const review = await model.reviews.findByPk(review_id);

    if (!review)
      return res.status(404).json({ message: "Không tìm thấy đánh giá" });

  
    review.is_visible = !review.is_visible;
    await review.save();

    return res.status(200).json({
      message: `Đã thay đổi trạng thái đánh giá thành ${review.is_visible}`,
      review_id: review.review_id,
      is_visible: review.is_visible,
    });
  } catch (error) {
    console.error("Lỗi toggleReviewVisibility:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
 const getAllReviews = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;


    const total = await model.reviews.count();

    if (total === 0) {
      return res.status(200).json({
        message: "Chưa có đánh giá nào.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;


    const reviews = await model.reviews.findAll({
      include: [
        {
          model: model.order_details,
          as: "order_detail",
          required: true,
          include: [
            {
              model: model.orders,
              as: "order",
              include: [
                {
                  model: model.users,
                  as: "user",
                  attributes: ["user_id", "full_name", "email", "gender"],
                },
              ],
            },
          ],
        },
        {
          model: model.review_images,
          as: "review_images",
          attributes: ["image"],
        },
        {
          model: model.review_reply,
          as: "review_reply",
          include: [
            {
              model: model.users,
              as: "user",
              attributes: ["user_id", "full_name", "email"],
            },
          ],
        },
      ],
      order: [["review_id", "DESC"]],
      limit: pageSize,
      offset,
    });

    const formattedData = reviews.map((r) => ({
      review_id: r.review_id,
      rating: r.rating,
      comment: r.comment,
      is_visible: r.is_visible,
      createdAt: formatVNDateTime(r.createdAt),
      images: r.review_images.map((img) => img.image),
      reviewer: r.order_detail?.order?.user
        ? {
            user_id: r.order_detail.order.user.user_id,
            full_name: r.order_detail.order.user.full_name,
            email: r.order_detail.order.user.email,
            gender: r.order_detail.order.user.gender,
          }
        : null,
      reply: r.review_reply
        ? {
            message: r.review_reply.message,
            replied_at: formatVNDateTime(r.review_reply.replied_at),
            replier: r.review_reply.user
              ? {
                  user_id: r.review_reply.user.user_id,
                  full_name: r.review_reply.user.full_name,
                  email: r.review_reply.user.email,
                }
              : null,
          }
        : null,
    }));

    return res.status(200).json({
      message: "Lấy danh sách đánh giá thành công",
      total,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getAllReviews:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const getReviewDetailByOrder = async (req, res) => {
  try {
    const { order_detail_id } = req.params;
    const user_id = req.user.user_id; 

    if (!order_detail_id)
      return res.status(400).json({ message: "Thiếu order_detail_id" });

    const review = await model.reviews.findOne({
      where: { order_detail_id: parseInt(order_detail_id) },
      include: [
        {
          model: model.order_details,
          as: "order_detail",
          required: true,
          include: [
            {
              model: model.orders,
              as: "order",
              where: { user_id }, 
              include: [
                {
                  model: model.users,
                  as: "user",
                  attributes: ["user_id", "full_name", "email", "gender"],
                },
              ],
            },
          ],
        },
        {
          model: model.review_images,
          as: "review_images",
          attributes: ["image"],
        },
        {
          model: model.review_reply,
          as: "review_reply",
          include: [
            {
              model: model.users,
              as: "user",
              attributes: ["user_id", "full_name", "email"],
            },
          ],
        },
      ],
    });

    if (!review) {
      return res.status(404).json({
        message: "Đơn hàng này không thuộc về bạn hoặc chưa có đánh giá.",
        data: null,
      });
    }

    const formattedData = {
      review_id: review.review_id,
      rating: review.rating,
      comment: review.comment,
      is_visible: review.is_visible,
      createdAt: formatVNDateTime(review.createdAt),
      images: review.review_images.map((img) => img.image),
      reviewer: review.order_detail?.order?.user
        ? {
            user_id: review.order_detail.order.user.user_id,
            full_name: review.order_detail.order.user.full_name,
            email: review.order_detail.order.user.email,
            gender: review.order_detail.order.user.gender,
          }
        : null,
      reply: review.review_reply
        ? {
            message: review.review_reply.message,
            replied_at: formatVNDateTime(review.review_reply.replied_at),
            replier: review.review_reply.user
              ? {
                  user_id: review.review_reply.user.user_id,
                  full_name: review.review_reply.user.full_name,
                  email: review.review_reply.user.email,
                }
              : null,
          }
        : null,
    };

    return res.status(200).json({
      message: "Lấy chi tiết đánh giá thành công",
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getReviewDetailByOrder:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export {
  createReview,
  replyReview,
  getReviewsByProduct,

  toggleReviewVisibility,
  getAllReviews,
  getReviewDetailByOrder
};
