import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import {
  formatVNDateTime,
  formatVNDate,
  formatCartItem,
} from "../utils/dateFormat.js";

dotenv.config();
const model = initModels(sequelize);
const getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const count = await model.payments.count();
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Không có dữ liệu thanh toán.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    const payments = await model.payments.findAll({
      attributes: [
        "payment_id",
        "order_id",
        "method",
        "total",
        "payment_date",
        "status",
      ],
      limit: pageSize,
      offset,
      order: [["payment_id", "DESC"]],
    });

    const formattedData = payments.map((payment) => ({
      payment_id: payment.payment_id,
      order_id: payment.order_id,
      method: payment.method,
      total: parseFloat(payment.total),
      payment_date: formatVNDateTime(payment.payment_date) || null,
      status: payment.status,
    }));

    return res.status(200).json({
      message: "Lấy danh sách thanh toán thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getAllPayments:", error);
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};

export { getAllPayments };
