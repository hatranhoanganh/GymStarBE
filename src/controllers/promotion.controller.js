import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDate } from "../utils/dateFormat.js";
import { Op } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const createPromotion = async (req, res) => {
  try {
    // --- trim toàn bộ string trong body ---
    const body = {};
    for (const key in req.body) {
      if (typeof req.body[key] === "string") {
        body[key] = req.body[key].trim();
      } else {
        body[key] = req.body[key];
      }
    }

    let {
      code,
      value,
      description,
      min_order_value,
      discount_type,
      max_discount,
      start_date,
      end_date,
      usage_per_user,
    } = body;

    // --- validate code ---
    if (!code)
      return res
        .status(400)
        .json({ message: "Code khuyến mãi không được để trống" });
    if (code.length < 3 || code.length > 30) {
      return res.status(400).json({ message: "Code phải từ 3 đến 30 ký tự" });
    }
    if (!/^[a-zA-Z0-9\s.,-]+$/.test(code)) {
      return res.status(400).json({
        message: "Code chỉ được chứa chữ, số, khoảng trắng và dấu ., -",
      });
    }

    // --- validate description ---
    if (!description)
      return res
        .status(400)
        .json({ message: "Description không được để trống" });
    if (description.length < 5 || description.length > 100) {
      return res
        .status(400)
        .json({ message: "Description phải từ 5 đến 100 ký tự" });
    }
    if (!/^[a-zA-ZÀ-ỹ0-9\s.,-]+$/u.test(description)) {
      return res.status(400).json({
        message: "Description chỉ được chứa chữ, số, khoảng trắng và dấu ., -",
      });
    }

    // --- validate discount_type ---
    if (!discount_type || !["fixed", "percent"].includes(discount_type)) {
      return res
        .status(400)
        .json({ message: "discount_type phải là 'fixed' hoặc 'percent'" });
    }

    // --- validate value ---
    value = Number(value);
    if (isNaN(value))
      return res.status(400).json({ message: "value phải là số" });

    if (discount_type === "fixed") {
      if (value < 20000 || value > 5000000)
        return res
          .status(400)
          .json({ message: "Value fixed phải từ 20,000 đến 5,000,000" });
    } else if (discount_type === "percent") {
      if (value < 0 || value > 99)
        return res
          .status(400)
          .json({ message: "Value percent phải từ 0 đến 99" });

      max_discount = Number(max_discount);
      if (isNaN(max_discount) || max_discount < 0 || max_discount > 5000000)
        return res
          .status(400)
          .json({ message: "max_discount phải từ 0 đến 5,000,000" });
    }

    if (!start_date || !end_date) {
      return res
        .status(400)
        .json({ message: "start_date và end_date là bắt buộc" });
    }

    const parseVNDate = (str) => {
      const [day, month, year] = str.split("/").map(Number);
      return new Date(year, month - 1, day);
    };

    const start = parseVNDate(start_date);
    const end = parseVNDate(end_date);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res
        .status(400)
        .json({ message: "start_date hoặc end_date không hợp lệ" });
    }

    // set giờ
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (start >= end) {
      return res
        .status(400)
        .json({ message: "start_date phải nhỏ hơn end_date" });
    }

    min_order_value = Number(min_order_value);
    if (
      isNaN(min_order_value) ||
      min_order_value < 200000 ||
      min_order_value > 10000000
    ) {
      return res.status(400).json({
        message: "min_order_value phải từ 200,000 đến 10,000,000",
      });
    }

    // usage_per_user: từ 1 -> 30
    usage_per_user = Number(usage_per_user);
    if (isNaN(usage_per_user) || usage_per_user < 1 || usage_per_user > 30) {
      return res.status(400).json({
        message: "usage_per_user phải từ 1 đến 30",
      });
    }

    // --- kiểm tra code trùng ---
    const existing = await model.promotions.findOne({ where: { code } });
    if (existing)
      return res.status(400).json({ message: "Code khuyến mãi đã tồn tại" });

    // --- tạo promotion ---
    const newPromotion = await model.promotions.create({
      code,
      value,
      description,
      min_order_value,
      discount_type,
      max_discount: discount_type === "percent" ? max_discount : null,
      start_date: start,
      end_date: end,
      usage_per_user,
      status: "active", // mặc định active
    });

    return res.status(201).json({
      message: "Tạo khuyến mãi thành công",
      data: newPromotion,
    });
  } catch (error) {
    console.error("Lỗi createPromotion:", error);
    return res.status(500).json({ message: "Lỗi server khi tạo khuyến mãi" });
  }
};
const updatePromotion = async (req, res) => {
  try {
    const { promotion_id } = req.params;

    /* ===============================
       TRIM STRING
    =============================== */
    const body = {};
    for (const key in req.body) {
      body[key] =
        typeof req.body[key] === "string"
          ? req.body[key].trim()
          : req.body[key];
    }

    /* ===============================
       FIND PROMOTION
    =============================== */
    const promotion = await model.promotions.findByPk(promotion_id);
    if (!promotion)
      return res.status(404).json({ message: "Khuyến mãi không tồn tại" });

    /* ===============================
       ❌ BLOCK FIELD UPDATE
    =============================== */
    const blockedFields = [
      "discount_type",
      "value",
      "max_discount",
      "min_order_value",
      "status",
    ];

    for (const field of blockedFields) {
      if (body[field] !== undefined) {
        return res.status(400).json({
          message: `Không được cập nhật ${field}`,
        });
      }
    }

    /* ===============================
       MERGE ALLOW FIELD
    =============================== */
    const code = body.code ?? promotion.code;
    const description = body.description ?? promotion.description;
    const usage_per_user = body.usage_per_user ?? promotion.usage_per_user;

    /* ===============================
       VALIDATE CODE
    =============================== */
    if (!code)
      return res.status(400).json({ message: "Code không được để trống" });

    if (code.length < 3 || code.length > 30)
      return res.status(400).json({ message: "Code phải từ 3 đến 30 ký tự" });

    if (!/^[a-zA-Z0-9\s.,-]+$/.test(code))
      return res.status(400).json({
        message: "Code chỉ được chứa chữ, số, khoảng trắng và dấu ., -",
      });

    const existing = await model.promotions.findOne({
      where: {
        code,
        promotion_id: { [Op.ne]: promotion_id },
      },
    });

    if (existing)
      return res.status(400).json({ message: "Code khuyến mãi đã tồn tại" });

    /* ===============================
       VALIDATE DESCRIPTION
    =============================== */
    if (!description)
      return res
        .status(400)
        .json({ message: "Description không được để trống" });

    if (description.length < 5 || description.length > 100)
      return res.status(400).json({
        message: "Description phải từ 5 đến 100 ký tự",
      });

    /* ===============================
       VALIDATE USAGE_PER_USER
    =============================== */
    const usage = Number(usage_per_user);
    if (isNaN(usage) || usage < 1 || usage > 30)
      return res.status(400).json({
        message: "usage_per_user phải từ 1 đến 30",
      });

    /* ===============================
       VALIDATE DATE
    =============================== */
    let start = promotion.start_date;
    let end = promotion.end_date;

    const parseVNDate = (str) => {
      const [day, month, year] = str.split("/").map(Number);
      return new Date(year, month - 1, day);
    };

    if (body.start_date) {
      start = parseVNDate(body.start_date);
      start.setHours(0, 0, 0, 0);
    }

    if (body.end_date) {
      end = parseVNDate(body.end_date);
      end.setHours(23, 59, 59, 999);
    }

    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      return res
        .status(400)
        .json({ message: "start_date hoặc end_date không hợp lệ" });

    if (start >= end)
      return res
        .status(400)
        .json({ message: "start_date phải nhỏ hơn end_date" });

    /* ===============================
       UPDATE
    =============================== */
    await promotion.update({
      code,
      description,
      start_date: start,
      end_date: end,
      usage_per_user: usage,
    });

    return res.json({
      message: "Cập nhật khuyến mãi thành công",
      data: promotion,
    });
  } catch (error) {
    console.error("Lỗi updatePromotion:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server khi cập nhật khuyến mãi" });
  }
};
const deletePromotion = async (req, res) => {
  try {
    const { promotion_id } = req.params;

    const promotion = await model.promotions.findByPk(promotion_id);
    if (!promotion)
      return res.status(404).json({ message: "Khuyến mãi không tồn tại" });

    const used = await model.promotion_usages.count({
      where: { promotion_id },
    });

    if (used > 0) {
      return res.status(400).json({
        message: "Khuyến mãi đã được sử dụng, không thể xóa",
      });
    }

    await promotion.destroy();

    return res.json({
      message: "Xóa khuyến mãi thành công",
    });
  } catch (error) {
    console.error("Lỗi deletePromotion:", error);
    return res.status(500).json({ message: "Lỗi server khi xóa khuyến mãi" });
  }
};
const togglePromotionStatus = async (req, res) => {
  try {
    const { promotion_id } = req.params;

    /* ===============================
       FIND PROMOTION
    =============================== */
    const promotion = await model.promotions.findByPk(promotion_id);

    if (!promotion) {
      return res.status(404).json({
        message: "Khuyến mãi không tồn tại",
      });
    }

    /* ===============================
       TOGGLE STATUS
    =============================== */
    let newStatus;
    if (promotion.status === "active") {
      newStatus = "inactive";
    } else if (promotion.status === "inactive") {
      newStatus = "active";
    } else {
      return res.status(400).json({
        message: "Trạng thái khuyến mãi không hợp lệ",
      });
    }

    await promotion.update({ status: newStatus });

    return res.json({
      message: "Cập nhật trạng thái khuyến mãi thành công",
      data: {
        promotion_id: promotion.promotion_id,
        new_status: newStatus,
      },
    });
  } catch (error) {
    console.error("Lỗi togglePromotionStatus:", error);
    return res.status(500).json({
      message: "Lỗi server khi thay đổi trạng thái khuyến mãi",
    });
  }
};
const getAllPromotions = async (req, res) => {
  try {
    /* ===============================
       PAGINATION (Y CHANG getAllUser)
    =============================== */
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const count = await model.promotions.count();
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Không có dữ liệu khuyến mãi.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    /* ===============================
       QUERY DATA
    =============================== */
    const promotions = await model.promotions.findAll({
      limit: pageSize,
      offset,
      order: [["promotion_id", "DESC"]],
    });

    const formattedData = promotions.map((promotion) => ({
      promotion_id: promotion.promotion_id,
      code: promotion.code,
      description: promotion.description,
      discount_type: promotion.discount_type,
      value: promotion.value,
      max_discount: promotion.max_discount,
      min_order_value: promotion.min_order_value,
      usage_per_user: promotion.usage_per_user,
      status: promotion.status,

      start_date: promotion.start_date
        ? formatVNDate(promotion.start_date)
        : null,

      end_date: promotion.end_date ? formatVNDate(promotion.end_date) : null,
    }));

    return res.status(200).json({
      message: "Lấy danh sách khuyến mãi thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getAllPromotions:", error);
    return res.status(500).json({
      message: "Lỗi server khi lấy danh sách khuyến mãi",
    });
  }
};
const getActivePromotionsForUser = async (req, res) => {
  try {
    const user_id = req.user.user_id;

    /* ===============================
       QUERY ACTIVE PROMOTIONS
    =============================== */
    const promotions = await model.promotions.findAll({
      where: {
        status: "active",
      },
      order: [["promotion_id", "DESC"]],
    });

    if (promotions.length === 0) {
      return res.status(200).json({
        message: "Không có khuyến mãi nào",
        data: [],
      });
    }

    /* ===============================
       FORMAT DATA (GIỐNG getAllPromotions)
    =============================== */
    const formattedData = [];

    for (const promotion of promotions) {
      // Đếm số lần user đã dùng promotion này
      const usedCount = await model.promotion_usages.count({
  where: {
    promotion_id: promotion.promotion_id,
  },
  include: [
    {
      model: model.orders,
      as: "order",          // 👈 QUAN TRỌNG
      required: true,
      where: { user_id },
    },
  ],
});


      // Tính số lượt còn lại
      let remaining_usage = null;
      if (promotion.usage_per_user !== null) {
        remaining_usage = Math.max(
          promotion.usage_per_user - usedCount,
          0
        );
      }

      formattedData.push({
        promotion_id: promotion.promotion_id,
        code: promotion.code,
        description: promotion.description,
        discount_type: promotion.discount_type,
        value: promotion.value,
        max_discount: promotion.max_discount,
        min_order_value: promotion.min_order_value,
        usage_per_user: promotion.usage_per_user,

        used_count: usedCount,
        remaining_usage,

        start_date: promotion.start_date
          ? formatVNDate(promotion.start_date)
          : null,

        end_date: promotion.end_date
          ? formatVNDate(promotion.end_date)
          : null,
      });
    }

    return res.status(200).json({
      message: "Lấy danh sách khuyến mãi thành công",
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getActivePromotionsForUser:", error);
    return res.status(500).json({
      message: "Lỗi server khi lấy danh sách khuyến mãi",
    });
  }
};



export {
  createPromotion,
  updatePromotion,
  deletePromotion,
  togglePromotionStatus,
  getAllPromotions,
  getActivePromotionsForUser,
};
