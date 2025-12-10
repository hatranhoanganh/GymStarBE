import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import {
  prepareMomoPayment,
  cancelOrderAndRestoreStock,
} from "./momo.controller.js";
import { Op } from "sequelize";


dotenv.config();
const model = initModels(sequelize);


 
const placeDirectOrder = async (req, res) => {
  let t;
  try {
    t = await sequelize.transaction();

    const user_id = req.user.user_id;
    const { product_variant_id, quantity = 1, note, address_id, method } = req.body;

    if (!product_variant_id || !method) {
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
    }

    const finalQuantity = parseInt(quantity);
    if (isNaN(finalQuantity) || finalQuantity < 1) {
      return res.status(400).json({ message: "Số lượng không hợp lệ" });
    }

    // Lấy địa chỉ
    let address = address_id
      ? await model.user_addresses.findOne({ where: { address_id, user_id } })
      : await model.user_addresses.findOne({ where: { user_id, is_default: true } });

    if (!address)
      return res.status(400).json({ message: "Địa chỉ không tồn tại" });

    // Lấy variant sản phẩm
    const variant = await model.product_variants.findByPk(product_variant_id, {
      include: [{ model: model.products, as: "product" }],
      transaction: t,
    });
    if (!variant)
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    if (variant.stock < finalQuantity) {
      return res.status(400).json({ message: "Hết hàng hoặc không đủ số lượng" });
    }

    const price = Number(variant.product.price);
    const discount = Number(variant.product.discount || 0);
    const finalPrice = Number((price * (1 - discount / 100)).toFixed(0));
    const totalAmount = finalPrice * finalQuantity;

    // Xử lý COD
    if (method === "COD") {
      const newOrder = await model.orders.create(
        {
          user_id,
          total: totalAmount,
          note,
          receiver_name: address.receiver_name,
          phone: address.phone,
          address_detail: address.address_detail,
          status: "chờ xác nhận",
        },
        { transaction: t }
      );

      await model.order_details.create(
        {
          order_id: newOrder.order_id,
          product_variant_id,
          quantity: finalQuantity,
          price: finalPrice,
          original_price: price,
        },
        { transaction: t }
      );

      await model.payments.create(
        {
          order_id: newOrder.order_id,
          method: "COD",
          total: totalAmount,
          status: "đang chờ",
        },
        { transaction: t }
      );

      await model.product_variants.decrement("stock", {
        by: finalQuantity,
        where: { product_variant_id },
        transaction: t,
      });

      await t.commit();

      return res.json({
        message: "Đặt hàng COD thành công",
        order_id: newOrder.order_id,
      });
    }

    // Xử lý MoMo
    if (method === "MOMO") {
      const newOrder = await model.orders.create(
        {
          user_id,
          total: totalAmount,
          note,
          receiver_name: address.receiver_name,
          phone: address.phone,
          address_detail: address.address_detail,
          status: "chờ xác nhận",
        },
        { transaction: t }
      );

      await model.order_details.create(
        {
          order_id: newOrder.order_id,
          product_variant_id,
          quantity: finalQuantity,
          price: finalPrice,
          original_price: price,
        },
        { transaction: t }
      );

      await model.payments.create(
        {
          order_id: newOrder.order_id,
          method: "MOMO",
          total: totalAmount,
          status: "đang chờ",
        },
        { transaction: t }
      );

      await model.product_variants.decrement("stock", {
        by: finalQuantity,
        where: { product_variant_id },
        transaction: t,
      });

      await t.commit();

      let momoResult;
      try {
        momoResult = await prepareMomoPayment(newOrder.order_id);
      } catch (error) {
        console.error("Lỗi gọi MoMo → hủy đơn và hoàn stock");
        await cancelOrderAndRestoreStock(newOrder.order_id);
        return res.status(500).json({
          message:
            "Lỗi kết nối MoMo. Đơn hàng đã được hủy và hoàn lại hàng tồn kho.",
        });
      }

      setTimeout(async () => {
        try {
          const payment = await model.payments.findOne({
            where: {
              order_id: newOrder.order_id,
              method: "MOMO",
              status: "đang chờ",
            },
          });
          if (payment) {
            await cancelOrderAndRestoreStock(newOrder.order_id);
            console.log(`Đơn MoMo #${newOrder.order_id} tự động hủy do khách thoát`);
          }
        } catch (err) {
          console.error("Lỗi tự động hủy đơn MoMo:", err);
        }
      }, 60 * 1000);

      return res.json({
        message: "Chuyển sang thanh toán MoMo",
        order_id: newOrder.order_id,
        payUrl: momoResult.payUrl,
      });
    }

    return res.status(400).json({ message: "Phương thức thanh toán không hỗ trợ" });
  } catch (error) {
    if (t && !t.finished) await t.rollback();
    console.error("Lỗi placeDirectOrder:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const placeCartOrder = async (req, res) => {
  let t;
  try {
    t = await sequelize.transaction();

    const user_id = req.user.user_id; 
    const { cart_item_ids, address_id, note, method } = req.body;

    if (!cart_item_ids || !Array.isArray(cart_item_ids) || cart_item_ids.length === 0)
      return res.status(400).json({ message: "Vui lòng chọn sản phẩm" });
    if (!method)
      return res.status(400).json({ message: "Chọn phương thức thanh toán" });

    let address = address_id
      ? await model.user_addresses.findOne({ where: { address_id, user_id } })
      : await model.user_addresses.findOne({ where: { user_id, is_default: true } });

    if (!address)
      return res.status(400).json({ message: "Chưa có địa chỉ giao hàng" });

    const cartItems = await model.carts.findAll({
      where: { cart_id: cart_item_ids, user_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          attributes: [
            "product_variant_id",
            "color",
            "size",
            "sku",
            "stock",
            "product_id",
          ],
          include: [
            {
              model: model.products,
              as: "product",
              attributes: ["name", "price", "discount", "thumbnail"],
            },
          ],
        },
      ],
      transaction: t,
    });

    if (cartItems.length === 0) {
      await t.rollback();
      return res.status(404).json({ message: "Giỏ hàng trống" });
    }

    let total = 0;
    const orderDetailsInput = [];

    for (const item of cartItems) {
      const variant = item.product_variant;
      const product = variant.product;

      const locked = await model.product_variants.findByPk(
        variant.product_variant_id,
        {
          transaction: t,
          lock: t.LOCK.UPDATE,
        }
      );

      if (!locked || locked.stock < item.quantity) {
        await t.rollback();
        return res
          .status(400)
          .json({ message: `Sản phẩm "${product.name}" không đủ hàng` });
      }

      const price = Number(product.price);
      const discount = Number(product.discount || 0);
      const finalPrice = Number((price * (1 - discount / 100)).toFixed(0));
      total += finalPrice * item.quantity;

      orderDetailsInput.push({
        product_variant_id: variant.product_variant_id,
        quantity: item.quantity,
        original_price: price,
        price: finalPrice,
      });
    }

    if (method === "COD") {
      const order = await model.orders.create(
        {
          user_id,
          total,
          note,
          receiver_name: address.receiver_name,
          phone: address.phone,
          address_detail: address.address_detail,
          status: "chờ xác nhận",
        },
        { transaction: t }
      );

      await model.order_details.bulkCreate(
        orderDetailsInput.map((d) => ({ ...d, order_id: order.order_id })),
        { transaction: t }
      );

      await model.payments.create(
        {
          order_id: order.order_id,
          method: "COD",
          total,
          status: "đang chờ",
        },
        { transaction: t }
      );

      for (const item of cartItems) {
        await model.product_variants.decrement("stock", {
          by: item.quantity,
          where: { product_variant_id: item.product_variant_id },
          transaction: t,
        });
      }

      await model.carts.destroy({
        where: { cart_id: cart_item_ids, user_id },
        transaction: t,
      });

      await t.commit();

      return res.json({
        message: "Đặt hàng COD thành công",
        order_id: order.order_id,
      });
    }

    if (method === "MOMO") {
      const order = await model.orders.create(
        {
          user_id,
          total,
          note,
          receiver_name: address.receiver_name,
          phone: address.phone,
          address_detail: address.address_detail,
          status: "chờ xác nhận",
        },
        { transaction: t }
      );

      await model.order_details.bulkCreate(
        orderDetailsInput.map((d) => ({ ...d, order_id: order.order_id })),
        { transaction: t }
      );

      await model.payments.create(
        {
          order_id: order.order_id,
          method: "MOMO",
          total,
          status: "đang chờ",
        },
        { transaction: t }
      );

      for (const item of cartItems) {
        await model.product_variants.decrement("stock", {
          by: item.quantity,
          where: { product_variant_id: item.product_variant_id },
          transaction: t,
        });
      }

      await model.carts.destroy({
        where: { cart_id: cart_item_ids, user_id },
        transaction: t,
      });

      await t.commit();

      let momoResult;
      try {
        momoResult = await prepareMomoPayment(order.order_id);
      } catch (err) {
        await cancelOrderAndRestoreStock(order.order_id);
        return res.status(500).json({ message: "Lỗi MoMo → đơn đã hủy" });
      }

      setTimeout(async () => {
        const p = await model.payments.findOne({
          where: {
            order_id: order.order_id,
            method: "MOMO",
            status: "đang chờ",
          },
        });
        if (p) {
          await cancelOrderAndRestoreStock(order.order_id);
          console.log(`Đơn #${order.order_id} tự động hủy (khách thoát)`);
        }
      }, 60 * 1000);

      return res.json({
        message: "Chuyển sang MoMo",
        order_id: order.order_id,
        payUrl: momoResult.payUrl,
      });
    }

    return res.status(400).json({ message: "Phương thức không hỗ trợ" });
  } catch (error) {
    if (t && !t.finished) await t.rollback();
    console.error("Lỗi placeCartOrder:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getOrdersByStatus = async (req, res) => {
  try {
    const { status, page = 1, limit = 10, user_id: queryUserId } = req.query;

    const role = req.user.role_name; 
    const tokenUserId = req.user.user_id;

    let userFilter = {};

    if (role === "Khách hàng") {
    
      userFilter.user_id = tokenUserId;
    } else if (role === "Quản trị viên" || role === "Quản lý đơn hàng") {
      if (queryUserId) userFilter.user_id = queryUserId;
    } else {
      return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    // Lọc theo trạng thái nếu có
    if (status) userFilter.status = status;

    // ====== PAGINATION ======
    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;

    const count = await model.orders.count({ where: userFilter });
    const totalPages = Math.ceil(count / pageSize);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    // ====== LẤY ĐƠN HÀNG ======
    const orders = await model.orders.findAll({
      where: userFilter,
      limit: pageSize,
      offset,
      order: [["order_id", "DESC"]],
      include: [
        {
          model: model.order_details,
          as: "order_details",
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
              include: [{ model: model.products, as: "product" }],
            },
          ],
        },
      ],
    });

    if (orders.length === 0) {
      return res.status(200).json({
        message: "Không có đơn hàng nào",
        total: 0,
        page: validPage,
        totalPages,
        data: [],
      });
    }

    // ====== FORMAT ======
    const formatted = orders.map((order) => {
      const items = order.order_details.map((detail) => {
        const p = detail.product_variant.product;
        const priceOriginal = Number(Number(p.price).toFixed(2));
        const discount = Number(Number(p.discount || 0).toFixed(2));
        const finalPrice = Number((priceOriginal * (1 - discount / 100)).toFixed(2));

        return {
          product_id: p.product_id,
          name: p.name,
          thumbnail: p.thumbnail,
          product_variant_id: detail.product_variant_id,
          color: detail.product_variant.color,
          size: detail.product_variant.size,
          sku: detail.product_variant.sku,
          quantity: detail.quantity,
          price_original: priceOriginal,
          discount,
          final_price: finalPrice,
        };
      });

      return {
        order_id: order.order_id,
        user_id: order.user_id,
        status: order.status,
        order_date: formatVNDateTime(order.order_date),
        total: Number(Number(order.total).toFixed(2)),
        items,
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách đơn hàng thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formatted,
    });
  } catch (error) {
    console.error("Lỗi getOrdersByStatus:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const getOrderDetail = async (req, res) => {
  try {
    const { order_id } = req.params;

    if (!order_id) {
      return res.status(400).json({ message: "Thiếu order_id" });
    }

    // Lấy thông tin người dùng từ token
    const role = req.user.role_name;  
    const currentUserId = req.user.user_id;

    // Lấy đơn hàng
    const order = await model.orders.findOne({
      where: { order_id },
      attributes: [
        "order_id",
        "order_date",
        "status",
        "total",
        "note",
        "receiver_name",
        "phone",
        "address_detail",
        "received_date",
        "user_id",
      ],
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "gender", "status"],
        },
        {
          model: model.payments,
          as: "payment",
          attributes: ["payment_id", "method", "total", "status", "payment_date"],
        },
        {
          model: model.order_details,
          as: "order_details",
          attributes: ["order_detail_id", "quantity", "price", "original_price"],
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
              attributes: ["product_variant_id", "color", "size", "sku"],
              include: [
                {
                  model: model.products,
                  as: "product",
                  attributes: ["product_id", "name", "thumbnail"],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }


    const allowedFullAccessRoles = ["Quản trị viên", "Quản lý đơn hàng"];
    if (!allowedFullAccessRoles.includes(role)) {
      if (order.user_id !== currentUserId) {
        return res.status(403).json({
          message: "Bạn không có quyền xem chi tiết đơn hàng của người khác",
        });
      }
    }

    // Format dữ liệu trả về
    const formattedData = {
      order_id: order.order_id,
      order_date: formatVNDateTime(order.order_date),
      status: order.status,
      total: Number(order.total),
      note: order.note || null,
      receiver_name: order.receiver_name,
      phone: order.phone,
      address_detail: order.address_detail,
      received_date: order.received_date
        ? formatVNDateTime(order.received_date)
        : null,
      user: order.user
        ? {
            user_id: order.user.user_id,
            full_name: order.user.full_name,
            email: order.user.email,
            gender: order.user.gender,
            status: order.user.status,
          }
        : null,
      payments: order.payments?.map((p) => ({
        payment_id: p.payment_id,
        method: p.method,
        total: Number(p.total),
        status: p.status,
        payment_date: p.payment_date ? formatVNDateTime(p.payment_date) : null,
      })) || [],
      items: order.order_details.map((item) => ({
        order_detail_id: item.order_detail_id,
        quantity: item.quantity,
        original_price: Number(
          item.original_price || item.product_variant.product.price
        ),
        price: Number(item.price),
        product: {
          product_id: item.product_variant.product.product_id,
          name: item.product_variant.product.name,
          thumbnail: item.product_variant.product.thumbnail,
        },
        variant: {
          product_variant_id: item.product_variant.product_variant_id,
          color: item.product_variant.color || null,
          size: item.product_variant.size || null,
          sku: item.product_variant.sku || null,
        },
      })),
    };

    return res.status(200).json({
      message: "Lấy chi tiết đơn hàng thành công",
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getOrderDetail:", error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};


const cancelOrder = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { order_id } = req.params;
    const { reason } = req.body;
    const { user_id } = req.user; 

    if (!reason) {
      await t.rollback();
      return res.status(400).json({ message: "Vui lòng chọn lý do hủy đơn hàng" });
    }

    // Lấy order theo order_id
    const order = await model.orders.findOne({
      where: { order_id: Number(order_id), user_id }, 
      include: [
        {
          model: model.order_details,
          as: "order_details",
          include: [{ model: model.product_variants, as: "product_variant" }],
        },
        {
          model: model.payments,
          as: "payment",
        },
      ],
      transaction: t,
    });

    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Đơn hàng không tồn tại hoặc không thuộc quyền của bạn" });
    }

    const allowed = ["chờ xác nhận", "đã xác nhận", "đang xử lý"];
    if (!allowed.includes(order.status)) {
      await t.rollback();
      return res.status(400).json({
        message: `Đơn hàng đang ở trạng thái "${order.status}", không thể hủy`,
      });
    }

    // Cập nhật trạng thái đơn
    await order.update({ status: "đã hủy" }, { transaction: t });

    // Cập nhật payment
    if (order.payment) {
      const updateData = { status: "thất bại" };
      if (order.payment.method === "COD") updateData.payment_date = sequelize.fn("NOW");
      await order.payment.update(updateData, { transaction: t });
    }

    // Lưu lý do hủy
    await model.reason_cancel.create(
      { order_id: order.order_id, reason: reason.trim() },
      { transaction: t }
    );

    // Hoàn lại stock
    for (const detail of order.order_details) {
      await detail.product_variant.increment("stock", {
        by: detail.quantity,
        transaction: t,
      });
    }

    await t.commit();

    return res.json({
      message: "Hủy đơn hàng thành công!",
      data: { order_id: order.order_id, canceled_reason: reason.trim() },
    });
  } catch (error) {
    await t.rollback();
    console.error("Lỗi hủy đơn hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


function removeVietnameseTones(str) {
  if (!str) return "";
  str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  str = str.replace(/đ/g, "d").replace(/Đ/g, "D");
  return str;
}

const getOrdersByKeyWord = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const trimmedKeyword = keyword.trim();

    let whereClause = {};

    if (trimmedKeyword) {
      const isPureNumber = /^\d+$/.test(trimmedKeyword);
      if (isPureNumber) {
        const orderIdExact = parseInt(trimmedKeyword, 10);
        whereClause.order_id = orderIdExact;
      } else {
        const noToneKeyword =
          removeVietnameseTones(trimmedKeyword).toLowerCase();

        whereClause[Op.or] = [
          sequelize.where(
            sequelize.cast(sequelize.col("orders.order_id"), "TEXT"),
            { [Op.like]: `%${trimmedKeyword}%` }
          ),
          sequelize.where(
            sequelize.fn(
              "LOWER",
              sequelize.fn("unaccent", sequelize.col("orders.receiver_name"))
            ),
            { [Op.like]: `%${noToneKeyword}%` }
          ),
          { phone: { [Op.like]: `%${trimmedKeyword}%` } },
          sequelize.where(
            sequelize.fn(
              "LOWER",
              sequelize.fn("unaccent", sequelize.col("orders.address_detail"))
            ),
            { [Op.like]: `%${noToneKeyword}%` }
          ),
        ];
      }
    }

    const totalCount = await model.orders.count({ where: whereClause });

    if (totalCount === 0) {
      return res.json({
        message: trimmedKeyword
          ? "Không tìm thấy đơn hàng nào"
          : "Không có đơn hàng nào",
        keyword: trimmedKeyword || null,
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const totalPages = Math.ceil(totalCount / limitNum);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * limitNum;

    const { rows: orders } = await model.orders.findAndCountAll({
      where: whereClause,
      limit: limitNum,
      offset,
      order: [["order_id", "DESC"]],
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "gender"],
        },

        {
          model: model.order_details,
          as: "order_details",
          attributes: ["quantity", "price", "original_price"],
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
              attributes: ["product_variant_id", "color", "size", "sku"],
              include: [
                {
                  model: model.products,
                  as: "product",
                  attributes: ["product_id", "name", "thumbnail"],
                },
              ],
            },
          ],
        },

        {
          model: model.payments,
          as: "payment",
          attributes: ["method", "status", "payment_date"],
        },
      ],
    });

    const formatted = orders.map((order) => ({
      order_id: order.order_id,
      status: order.status,
      order_date: formatVNDateTime(order.order_date),
      total: parseFloat(order.total || 0),
      receiver_name: order.receiver_name,
      phone: order.phone,
      address_detail: order.address_detail,
      note: order.note || null,

      user: {
        user_id: order.user.user_id,
        full_name: order.user.full_name,
        email: order.user.email,
        gender: order.user.gender,
      },

      payment: {
        method: order.payment.method,
        status: order.payment.status,
        payment_date: formatVNDateTime(order.payment.payment_date) || null,
      },

      items: (order.order_details || []).map((detail) => ({
        product_id: detail.product_variant.product.product_id,
        name: detail.product_variant.product.name,
        thumbnail: detail.product_variant.product.thumbnail,
        product_variant_id: detail.product_variant_id,
        color: detail.product_variant.color,
        size: detail.product_variant.size || null,
        sku: detail.product_variant.sku,
        quantity: detail.quantity,
        price_original: parseFloat(detail.original_price || 0),
        final_price: parseFloat(detail.price || 0),
      })),
    }));

    return res.json({
      message: "Tìm kiếm đơn hàng thành công",
      keyword: trimmedKeyword || null,
      total: totalCount,
      page: validPage,
      totalPages,
      data: formatted,
    });
  } catch (error) {
    console.error("Lỗi getOrdersByKeyWord:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getAllOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;

    const totalCount = await model.orders.count();

    if (totalCount === 0) {
      return res.json({
        message: "Không có đơn hàng nào",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const totalPages = Math.ceil(totalCount / limitNum);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * limitNum;

    const { count, rows: orders } = await model.orders.findAndCountAll({
      limit: limitNum,
      offset,
      order: [["order_id", "DESC"]],
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "gender"],
        },

        {
          model: model.order_details,
          as: "order_details",
          attributes: ["quantity", "price", "original_price"],
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
              attributes: ["product_variant_id", "color", "size", "sku"],
              include: [
                {
                  model: model.products,
                  as: "product",
                  attributes: ["product_id", "name", "thumbnail"],
                },
              ],
            },
          ],
        },

        {
          model: model.payments,
          as: "payment",
          attributes: ["method", "status", "payment_date"],
        },
      ],
    });

    const formatted = orders.map((order) => ({
      order_id: order.order_id,
      status: order.status,
      order_date: formatVNDateTime(order.order_date),
      total: parseFloat(order.total || 0),
      receiver_name: order.receiver_name,
      phone: order.phone,
      address_detail: order.address_detail,
      note: order.note || null,

      user: {
        user_id: order.user.user_id,
        full_name: order.user.full_name,
        email: order.user.email,
        gender: order.user.gender,
      },

      payment: {
        method: order.payment.method,
        status: order.payment.status,
        payment_date: formatVNDateTime(order.payment.payment_date) || null,
      },

      items: (order.order_details || []).map((detail) => ({
        product_id: detail.product_variant.product.product_id,
        name: detail.product_variant.product.name,
        thumbnail: detail.product_variant.product.thumbnail,
        product_variant_id: detail.product_variant_id,
        color: detail.product_variant.color,
        size: detail.product_variant.size || null,
        sku: detail.product_variant.sku,
        quantity: detail.quantity,
        price_original: parseFloat(detail.original_price || 0),
        final_price: parseFloat(detail.price || 0),
      })),
    }));

    return res.json({
      message: "Lấy danh sách đơn hàng thành công",
      total: totalCount,
      page: validPage,
      totalPages,
      data: formatted,
    });
  } catch (error) {
    console.error("Lỗi getAllOrders:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const updateOrderStatus = async (req, res) => {
  const t = await req.sequelize.transaction();
  try {
    const { order_id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ message: "Vui lòng chọn trạng thái mới" });
    }

    const validStatuses = [
      "chờ xác nhận",
      "đã xác nhận",
      "đang xử lý",
      "đang giao",
      "đã giao",
      "giao thất bại",
      "đổi hàng",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ" });
    }

    const order = await model.orders.findByPk(order_id, {
      include: [
        { model: model.payments, as: "payment", required: true },
        {
          model: model.order_details,
          as: "order_details",
          include: [{ model: model.product_variants, as: "product_variant" }],
        },
      ],
      transaction: t,
    });

    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

    const current = order.status;

    // === QUY TẮC CHUYỂN TRẠNG THÁI NGHIÊM NGẶT ===
    const allowedTransitions = {
      "chờ xác nhận": ["đã xác nhận"],
      "đã xác nhận": ["đang xử lý"],
      "đang xử lý": ["đang giao"],
      "đang giao": ["đã giao", "giao thất bại"],
      "giao thất bại": [],
      "đã giao": ["đổi hàng"],
      "đổi hàng": [],
    };

    if (!allowedTransitions[current].includes(status)) {
      await t.rollback();
      return res.status(400).json({
        message: "Không được phép chuyển trạng thái này",
        current_status: current,
        requested_status: status,
        allowed: allowedTransitions[current],
      });
    }

    if (status === "đã giao") {
      order.received_date = new Date();
      order.payment.status = "thành công";
      order.payment.payment_date = new Date();
    }

    if (status === "giao thất bại" || status === "đổi hàng") {
      order.payment.status = "thất bại";
      order.payment.payment_date = null;
    }

    if (status === "đổi hàng" || status === "giao thất bại") {
      for (const detail of order.order_details) {
        await detail.product_variant.increment("stock", {
          by: detail.quantity,
          transaction: t,
        });
      }
    }

    order.status = status;
    await order.save({ transaction: t });
    await order.payment.save({ transaction: t });

    await t.commit();

    return res.json({
      message: "Cập nhật trạng thái thành công",
      data: {
        order_id: order.order_id,
        old_status: current,
        new_status: status,
        payment_status: order.payment.status,
        stock_restored: status === "đổi hàng",
        received_date: order.received_date,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Lỗi updateOrderStatus:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export {
  placeDirectOrder,
  placeCartOrder,
  getOrdersByStatus,
  getOrderDetail,
  cancelOrder,
  getOrdersByKeyWord,
  getAllOrders,
  updateOrderStatus,
};
