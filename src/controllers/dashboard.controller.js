import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, fn, col, literal } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const getDashboardStats = async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const yesterdayEnd = new Date(todayStart);

    const [
      totalUsers,
      totalOrders,
      totalProducts,
      revenueToday,
      revenueYesterday,
    ] = await Promise.all([
      model.users.count(),
      model.orders.count(),

      model.products.count(),

      model.orders.sum("total", {
        where: {
          status: "đã giao",
          order_date: { [Op.gte]: todayStart },
        },
      }),

      model.orders.sum("total", {
        where: {
          status: "đã giao",
          order_date: {
            [Op.gte]: yesterdayStart,
            [Op.lt]: yesterdayEnd,
          },
        },
      }),
    ]);

    const revenueTodayValue = Number(revenueToday || 0);
    const revenueYesterdayValue = Number(revenueYesterday || 0);

    const calcTrend = (today, yesterday) => {
      if (yesterday === 0) {
        return {
          value: today > 0 ? 100 : 0,
          isUp: today > 0,
        };
      }
      const diff = ((today - yesterday) / yesterday) * 100;
      return {
        value: Math.abs(Number(diff.toFixed(1))),
        isUp: diff >= 0,
      };
    };

    const stats = [
      {
        title: "Khách hàng",
        value: totalUsers,
        trend: { value: 0, isUp: true },
      },
      {
        title: "Đơn hàng",
        value: totalOrders,
        trend: { value: 0, isUp: true },
      },
      {
        title: "Doanh thu",
        value: revenueTodayValue,
        trend: calcTrend(revenueTodayValue, revenueYesterdayValue),
      },
      {
        title: "Sản phẩm",
        value: totalProducts,
        trend: { value: 0, isUp: true },
      },
    ];

    const revenueDataRaw = await model.orders.findAll({
      attributes: [
        [fn("DATE", col("order_date")), "date"],
        [fn("SUM", col("total")), "revenue"],
        [fn("COUNT", col("order_id")), "orders"],
      ],
      where: { status: "đã giao" },
      group: [literal('DATE("order_date")')],
      order: [[literal('DATE("order_date")'), "ASC"]],
      raw: true,
    });

    const revenueData = revenueDataRaw.map((i) => ({
      date: i.date,
      revenue: Number(i.revenue),
      orders: Number(i.orders),
    }));

    const topProducts = await sequelize.query(
      `
  SELECT 
    p.product_id,
    p.name,
    c.name AS category_name,
    SUM(od.quantity) AS sold,
    SUM(od.quantity * od.price) AS revenue
  FROM order_details od
  JOIN orders o 
    ON o.order_id = od.order_id
  JOIN product_variants pv 
    ON pv.product_variant_id = od.product_variant_id
  JOIN products p 
    ON p.product_id = pv.product_id
  LEFT JOIN categories c 
    ON c.category_id = p.category_id
  WHERE o.status = 'đã giao'
  GROUP BY p.product_id, p.name, c.name
  ORDER BY sold DESC
  LIMIT 5
  `,
      { type: sequelize.QueryTypes.SELECT }
    );

    const recentOrdersRaw = await model.orders.findAll({
      attributes: ["order_id", "total", "status", "order_date"],
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["full_name"],
        },
      ],
      order: [["order_date", "DESC"]],
      limit: 5,
    });

    const recentOrders = recentOrdersRaw.map((o) => ({
      order_id: `DH${o.order_id.toString().padStart(3, "0")}`,
      customer: o.user?.full_name || "Khách vãng lai",
      total: Number(o.total),
      status: o.status,
      order_date: formatVNDateTime(o.order_date),
    }));

    const orderStatusRaw = await model.orders.findAll({
      attributes: ["status", [fn("COUNT", col("order_id")), "value"]],
      group: ["status"],
      raw: true,
    });

    const orderStatus = orderStatusRaw.map((i) => ({
      status: i.status,
      value: Number(i.value),
    }));

    return res.status(200).json({
      message: "Lấy dữ liệu dashboard thành công",
      stats,
      revenueData,
      topProducts,
      recentOrders,
      orderStatus,
    });
  } catch (error) {
    console.error("Lỗi getDashboardStats:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export { getDashboardStats };
