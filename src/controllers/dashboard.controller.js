import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, fn,literal, col } from "sequelize";

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

const getTopProductsThisMonth = async (req, res) => {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const topProducts = await model.order_details.findAll({
      attributes: [
        [fn("SUM", col("order_details.quantity")), "sold"],
        [
          fn(
            "SUM",
            literal("order_details.quantity * order_details.price")
          ),
          "revenue",
        ],
      ],
      include: [
        {
          model: model.orders,
          as: "order",
          attributes: [],
          where: {
            status: "đã giao",
            order_date: {
              [Op.gte]: monthStart,
              [Op.lt]: monthEnd,
            },
          },
        },
        {
          model: model.product_variants,
          as: "product_variant",
          attributes: [],
          include: [
            {
              model: model.products,
              as: "product",
              attributes: ["product_id", "name"],
              include: [
                {
                  model: model.categories,
                  as: "category",
                  attributes: ["name"], 
                },
              ],
            },
          ],
        },
      ],
      group: [
        "product_variant.product.product_id",
        "product_variant.product.name",
        "product_variant.product.category.category_id", 
        "product_variant.product.category.name",
      ],
      order: [[fn("SUM", col("order_details.quantity")), "DESC"]],
      limit: 5,
      raw: true,
    });

    return res.status(200).json({
      message: "Top 5 sản phẩm bán chạy trong tháng",
      month: monthStart.getMonth() + 1,
      year: monthStart.getFullYear(),
      topProducts: topProducts.map((i) => ({
        name: i["product_variant.product.name"],
        category_name: i["product_variant.product.category.name"],
        sold: Number(i.sold),
        revenue: Number(i.revenue),
      })),
    });
  } catch (error) {
    console.error("Lỗi getTopProductsThisMonth:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getRevenueByDateRange = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({ message: "Thiếu from hoặc to" });
    }

    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);

    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    const revenueDataRaw = await model.orders.findAll({
      attributes: [
        [
          literal(
            `DATE("orders"."order_date" AT TIME ZONE 'Asia/Ho_Chi_Minh')`
          ),
          "date",
        ],
        [fn("SUM", col("total")), "revenue"],
        [fn("COUNT", col("order_id")), "orders"],
      ],
      where: {
        status: "đã giao",
        order_date: {
          [Op.between]: [fromDate, toDate],
        },
      },
      group: [
        literal(
          `DATE("orders"."order_date" AT TIME ZONE 'Asia/Ho_Chi_Minh')`
        ),
      ],
      order: [
        [
          literal(
            `DATE("orders"."order_date" AT TIME ZONE 'Asia/Ho_Chi_Minh')`
          ),
          "ASC",
        ],
      ],
      raw: true,
    });

    const revenueData = revenueDataRaw.map((item) => ({
      date: item.date, // yyyy-mm-dd
      revenue: Number(item.revenue),
      orders: Number(item.orders),
    }));

    return res.status(200).json({
      message: "Lấy doanh thu theo ngày thành công",
      from: fromDate,
      to: toDate,
      revenueData,
    });
  } catch (error) {
    console.error("Lỗi getRevenueByDateRange:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};



export { getDashboardStatsToday,getTopProductsThisMonth,getRevenueByDateRange };
