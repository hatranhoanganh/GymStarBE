import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, fn, col } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const getDashboardStatsToday = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [totalUsers, totalOrdersToday, revenueToday, productsSoldToday] =
      await Promise.all([
        model.users.count(),

        model.orders.count({
          where: {
            order_date: {
              [Op.gte]: todayStart,
              [Op.lt]: todayEnd,
            },
          },
        }),

        model.orders.sum("total", {
          where: {
            status: "đã giao",
            order_date: {
              [Op.gte]: todayStart,
              [Op.lt]: todayEnd,
            },
          },
        }),

        model.order_details.sum("quantity", {
          include: [
            {
              model: model.orders,
              as: "order",
              where: {
                order_date: {
                  [Op.gte]: todayStart,
                  [Op.lt]: todayEnd,
                },
              },
              attributes: [],
            },
          ],
        }),
      ]);

    const orderStatusRaw = await model.orders.findAll({
      attributes: ["status", [fn("COUNT", col("order_id")), "value"]],
      where: {
        order_date: {
          [Op.gte]: todayStart,
          [Op.lt]: todayEnd,
        },
      },
      group: ["status"],
      raw: true,
    });

    const orderStatus = orderStatusRaw.map((i) => ({
      status: i.status,
      value: Number(i.value),
    }));

    return res.status(200).json({
      message: "Lấy dashboard hôm nay thành công",
      date: formatVNDateTime(todayStart),

      stats: [
        {
          title: "Người dùng",
          value: totalUsers,
        },
        {
          title: "Đơn hàng hôm nay",
          value: totalOrdersToday,
        },
        {
          title: "Doanh thu hôm nay",
          value: Number(revenueToday || 0),
        },
        {
          title: "Sản phẩm bán ra hôm nay",
          value: Number(productsSoldToday || 0),
        },
      ],

      orderStatusToday: orderStatus,
    });
  } catch (error) {
    console.error("Lỗi getDashboardStatsToday:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export { getDashboardStatsToday };
