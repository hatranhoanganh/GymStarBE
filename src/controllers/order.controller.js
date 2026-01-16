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
    const user_id = req.user.user_id;
    const {
      product_variant_id,
      quantity = 1,
      note,
      address_id,
      method,
      promotion_code,
    } = req.body;

  
    if (!product_variant_id || !method)
      return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });

    const finalQuantity = parseInt(quantity);
    if (isNaN(finalQuantity) || finalQuantity < 1)
      return res.status(400).json({ message: "Số lượng không hợp lệ hoặc <1" });

    if (finalQuantity > 10)
      return res.status(400).json({ message: "Số lượng tối đa là 10" });

    
    t = await sequelize.transaction();


    const address = address_id
      ? await model.user_addresses.findOne({
          where: { address_id, user_id },
          transaction: t,
        })
      : await model.user_addresses.findOne({
          where: { user_id, is_default: true },
          transaction: t,
        });

    if (!address) {
      await t.rollback();
      return res.status(400).json({ message: "Địa chỉ không tồn tại" });
    }

  
    const variant = await model.product_variants.findOne({
      where: { product_variant_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!variant) {
      await t.rollback();
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }


    const product = await model.products.findByPk(variant.product_id, {
      transaction: t,
    });

    if (!product) {
      await t.rollback();
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    if (product.status !== "đang bán") {
      await t.rollback();
      return res.status(400).json({
        message: "Sản phẩm hiện không được phép đặt hàng",
      });
    }

  
    if (variant.stock === 0) {
      await t.rollback();
      return res.status(400).json({
        message: "Sản phẩm đã hết hàng",
      });
    }

    if (variant.stock < finalQuantity) {
      await t.rollback();
      return res.status(400).json({
        message: `Chỉ còn ${variant.stock} sản phẩm trong kho`,
        available_stock: variant.stock,
      });
    }

 
    const basePrice = Number(variant.price);
    const discountPercent = product.discount
      ? parseFloat(product.discount)
      : 0;

    const discountedPrice =
      discountPercent > 0
        ? basePrice * (1 - discountPercent / 100)
        : basePrice;

    const finalPrice = Math.floor(discountedPrice / 1000) * 1000;

    let totalAmount = finalPrice * finalQuantity;
    let discount_amount = 0;
    let promotion = null;

    if (promotion_code) {
      promotion = await model.promotions.findOne({
        where: {
          code: promotion_code,
          status: "active",
          start_date: { [Op.lte]: new Date() },
          [Op.or]: [
            { end_date: null },
            { end_date: { [Op.gte]: new Date() } },
          ],
        },
        transaction: t,
      });

      if (!promotion) {
        await t.rollback();
        return res
          .status(400)
          .json({ message: "Mã khuyến mãi không hợp lệ hoặc hết hạn" });
      }

      const usageCount = await model.promotion_usages.count({
        where: { promotion_id: promotion.promotion_id },
        include: [
          {
            model: model.orders,
            as: "order",
            where: { user_id },
            attributes: [],
          },
        ],
        transaction: t,
      });

      if (usageCount >= promotion.usage_per_user) {
        await t.rollback();
        return res.status(400).json({
          message: "Bạn đã hết lượt dùng mã này",
        });
      }

      if (
        promotion.min_order_value &&
        totalAmount < Number(promotion.min_order_value)
      ) {
        await t.rollback();
        return res.status(400).json({
          message: "Đơn hàng chưa đủ điều kiện áp dụng mã giảm giá",
        });
      }

      if (promotion.discount_type === "fixed") {
        discount_amount = Number(promotion.value);
      } else if (promotion.discount_type === "percent") {
        discount_amount = (totalAmount * Number(promotion.value)) / 100;
        if (promotion.max_discount) {
          discount_amount = Math.min(
            discount_amount,
            Number(promotion.max_discount)
          );
        }
      }

      totalAmount = Math.max(totalAmount - discount_amount, 0);
      
    }

 
    const newOrder = await model.orders.create(
      {
        user_id,
        total: totalAmount,
        note,
        received_date: null,
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
        original_price: basePrice,
        discount: discountPercent > 0 ? discountPercent : null,
      },
      { transaction: t }
    );

    if (promotion) {
      await model.promotion_usages.create(
        {
          promotion_id: promotion.promotion_id,
          order_id: newOrder.order_id,
        },
        { transaction: t }
      );
    }

    await model.product_variants.decrement("stock", {
      by: finalQuantity,
      where: { product_variant_id },
      transaction: t,
    });

    const payment = await model.payments.create(
      {
        order_id: newOrder.order_id,
        method,
        total: totalAmount,
        status: "đang chờ",
        payment_date: null,
      },
      { transaction: t }
    );

    await t.commit();

    
    if (method === "MOMO") {
      try {
        const momoResult = await prepareMomoPayment(newOrder.order_id);
        return res.json({
          message: "Chuyển sang thanh toán MoMo",
          order_id: newOrder.order_id,
          payment,
          discount_amount,
          payUrl: momoResult.payUrl,
        });
      } catch (err) {
        await model.payments.destroy({
          where: { order_id: newOrder.order_id },
        });
        await cancelOrderAndRestoreStock(newOrder.order_id);
        return res.status(500).json({
          message:
            "Lỗi kết nối MoMo. Đơn hàng đã bị hủy và hoàn lại hàng tồn kho.",
        });
      }
    }

    return res.json({
      message: "Đặt hàng COD thành công",
      order_id: newOrder.order_id,
      payment,
      discount_amount,
    });
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

     const MAX_PER_VARIANT = 10;
    const MAX_TOTAL_QUANTITY = 30;

    const user_id = req.user.user_id;
    const { cart_detail_ids, address_id, note, method, promotion_code } =
      req.body;

    if (
      !cart_detail_ids ||
      !Array.isArray(cart_detail_ids) ||
      cart_detail_ids.length === 0
    ) {
      return res.status(400).json({ message: "Vui lòng chọn sản phẩm" });
    }

    if (!method || !["COD", "MOMO"].includes(method)) {
      return res
        .status(400)
        .json({ message: "Phương thức thanh toán không hợp lệ" });
    }

    const address = address_id
      ? await model.user_addresses.findOne({
          where: { address_id, user_id },
          transaction: t,
        })
      : await model.user_addresses.findOne({
          where: { user_id, is_default: true },
          transaction: t,
        });

    if (!address) {
      return res.status(400).json({ message: "Chưa có địa chỉ giao hàng" });
    }

    const cartItems = await model.cart_details.findAll({
      where: { cart_detail_id: cart_detail_ids },
      include: [
        {
          model: model.carts,
          as: "cart",
          where: { user_id },
          attributes: ["cart_id"],
        },
        {
          model: model.product_variants,
          as: "product_variant",
          attributes: [
            "product_variant_id",
            "color",
            "size",
            "sku",
            "stock",
            "price",
            "product_id",
          ],
          lock: { level: t.LOCK.UPDATE, of: model.product_variants },
          include: [
            {
              model: model.products,
              as: "product",
              attributes: ["name", "discount", "thumbnail", "status"],
            },
          ],
        },
      ],
      transaction: t,
    });

    if (cartItems.length === 0) {
      return res
        .status(404)
        .json({ message: "Giỏ hàng trống hoặc sản phẩm không thuộc về bạn" });
    }
    const totalQuantity = cartItems.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    if (totalQuantity > MAX_TOTAL_QUANTITY) {
      return res.status(400).json({
        message: `Mỗi đơn hàng chỉ được tối đa ${MAX_TOTAL_QUANTITY} sản phẩm`,
      });
    }

    for (const item of cartItems) {
      if (item.quantity > MAX_PER_VARIANT) {
        return res.status(400).json({
          message: `Sản phẩm "${item.product_variant.product.name}" chỉ được mua tối đa ${MAX_PER_VARIANT} cái`,
        });
      }
    }

    let totalAmount = 0;
    const orderDetailsInput = [];

    for (const item of cartItems) {
      const variant = item.product_variant;
      const product = variant?.product;

    
      if (!variant || !product) {
        return res.status(404).json({
          message: "Sản phẩm không tồn tại",
          product_variant_id: item.product_variant_id,
        });
      }

     
      if (product.status !== "đang bán") {
        return res.status(400).json({
          message: `Sản phẩm "${product.name}" hiện đã ngưng bán`,
        });
      }

      
      if (variant.stock === 0) {
        return res.status(400).json({
          message: `Sản phẩm "${product.name}" (${variant.color || ""} ${
            variant.size || ""
          }) đã hết hàng`,
        });
      }

    
      if (variant.stock < item.quantity) {
        return res.status(400).json({
          message: `Sản phẩm "${product.name}" (${variant.color || ""} ${
            variant.size || ""
          }) chỉ còn ${variant.stock} sản phẩm`,
          available_stock: variant.stock,
        });
      }

      const basePrice = Number(variant.price);
      const discountPercent = product.discount
        ? parseFloat(product.discount)
        : 0;

      const discountedPrice =
        discountPercent > 0
          ? basePrice * (1 - discountPercent / 100)
          : basePrice;

      const finalPrice = Math.floor(discountedPrice / 1000) * 1000;

      totalAmount += finalPrice * item.quantity;

      orderDetailsInput.push({
        product_variant_id: variant.product_variant_id,
        quantity: item.quantity,
        original_price: basePrice,
        price: finalPrice,
        discount: discountPercent > 0 ? discountPercent : null,
      });
    }

    let discount_amount = 0;
    let promotion = null;

    if (promotion_code) {
      promotion = await model.promotions.findOne({
        where: {
          code: promotion_code,
          status: "active",
          start_date: { [Op.lte]: new Date() },
          [Op.or]: [{ end_date: null }, { end_date: { [Op.gte]: new Date() } }],
        },
        transaction: t,
      });

      if (!promotion) {
        return res
          .status(400)
          .json({ message: "Mã khuyến mãi không hợp lệ hoặc hết hạn" });
      }

      const usageCount = await model.promotion_usages.count({
        where: { promotion_id: promotion.promotion_id },
        include: [
          {
            model: model.orders,
            as: "order",
            where: { user_id },
            attributes: [],
          },
        ],
        transaction: t,
      });

      if (usageCount >= promotion.usage_per_user) {
        return res.status(400).json({ message: "Bạn đã hết lượt dùng mã này" });
      }

      if (
        promotion.min_order_value &&
        totalAmount < Number(promotion.min_order_value)
      ) {
        return res
          .status(400)
          .json({ message: "Đơn hàng chưa đủ điều kiện áp dụng mã giảm giá" });
      }

      if (promotion.discount_type === "fixed") {
        discount_amount = Number(promotion.value);
      } else if (promotion.discount_type === "percent") {
        discount_amount = (totalAmount * Number(promotion.value)) / 100;
        if (promotion.max_discount) {
          discount_amount = Math.min(
            discount_amount,
            Number(promotion.max_discount)
          );
        }
      }

      totalAmount = Math.max(totalAmount - discount_amount, 0);
  
    }

    const order = await model.orders.create(
      {
        user_id,
        total: totalAmount,
        note,
        received_date: null,
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

    if (promotion) {
      await model.promotion_usages.create(
        {
          promotion_id: promotion.promotion_id,
          order_id: order.order_id,
        },
        { transaction: t }
      );
    }

    for (const item of cartItems) {
      await model.product_variants.decrement("stock", {
        by: item.quantity,
        where: { product_variant_id: item.product_variant_id },
        transaction: t,
      });
    }

    await model.cart_details.destroy({
      where: { cart_detail_id: cart_detail_ids },
      transaction: t,
    });

    const payment = await model.payments.create(
      {
        order_id: order.order_id,
        method,
        total: totalAmount,
        status: "đang chờ",
        payment_date: null,
      },
      { transaction: t }
    );

    await t.commit();

    if (method === "MOMO") {
      try {
        const momoResult = await prepareMomoPayment(order.order_id);
        return res.json({
          message: "Chuyển sang thanh toán MoMo",
          order_id: order.order_id,
          payment,
          discount_amount,
          payUrl: momoResult.payUrl,
        });
      } catch (err) {
        await model.payments.destroy({ where: { order_id: order.order_id } });
        await cancelOrderAndRestoreStock(order.order_id);
        return res.status(500).json({
          message:
            "Lỗi kết nối MoMo. Đơn hàng đã bị hủy và hoàn lại hàng tồn kho.",
        });
      }
    }

    return res.json({
      message: "Đặt hàng COD thành công",
      order_id: order.order_id,
      payment,
      discount_amount,
    });
  } catch (error) {
    if (t && !t.finished) await t.rollback();
    console.error("Lỗi placeCartOrder:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const getOrderDetail = async (req, res) => {
  try {
    const { order_id } = req.params;

    if (!order_id) {
      return res.status(400).json({ message: "Thiếu order_id" });
    }

    const role = req.user.role_name;
    const currentUserId = req.user.user_id;

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
            {
              model: model.reviews,
              as: "review",
              attributes: ["review_id"],
              required: false,
            },
          ],
        },
        {
          model: model.promotion_usages,
          as: "promotion_usage",
          required: false,
          include: [
            {
              model: model.promotions,
              as: "promotion",
              attributes: [
                "promotion_id",
                "discount_type",
                "value",
                "max_discount",
              ],
            },
          ],
        },
      ],
    });

    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

  
    const hasMomoPayment =
      order.payment?.some((p) => p.method === "MOMO") || false;

    const hasSuccessPayment =
      order.payment?.some((p) => p.status === "thành công") || false;

    const expired =
      Date.now() - new Date(order.order_date).getTime() >
      15 * 60 * 1000;

    if (
      order.status === "chờ xác nhận" &&
      hasMomoPayment &&
      !hasSuccessPayment &&
      expired
    ) {
      await cancelOrderAndRestoreStock(order.order_id);

      return res.status(400).json({
        message: "Đơn hàng MoMo đã hết hạn 15 phút và đã bị hủy.",
      });
    }


    const allowedFullAccessRoles = ["Quản trị viên", "Quản lý đơn hàng"];
    if (
      !allowedFullAccessRoles.includes(role) &&
      order.user_id !== currentUserId
    ) {
      return res.status(403).json({
        message: "Bạn không có quyền xem chi tiết đơn hàng của người khác",
      });
    }

  
    const latestPayment =
      order.payment && order.payment.length > 0
        ? order.payment.sort((a, b) => b.payment_id - a.payment_id)[0]
        : null;

    let discount_amount = 0;
    if (order.promotion_usage && order.promotion_usage.promotion) {
      const promo = order.promotion_usage.promotion;

      const totalBeforePromo = order.order_details.reduce(
        (sum, item) => sum + Number(item.price) * item.quantity,
        0
      );

      if (promo.discount_type === "fixed") {
        discount_amount = Number(promo.value);
      } else if (promo.discount_type === "percent") {
        discount_amount =
          (totalBeforePromo * Number(promo.value)) / 100;

        if (promo.max_discount) {
          discount_amount = Math.min(
            discount_amount,
            Number(promo.max_discount)
          );
        }
      }
    }

   
    const formattedData = {
      order_id: order.order_id,
      order_date: formatVNDateTime(order.order_date),
      status: order.status,
      payment_status: latestPayment?.status || "đang chờ",
      total: Number(order.total),
      discount_amount,
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

      payments: order.payment
        ? order.payment.map((p) => ({
            payment_id: p.payment_id,
            method: p.method,
            total: Number(p.total),
            status: p.status,
            payment_date: p.payment_date
              ? formatVNDateTime(p.payment_date)
              : null,
          }))
        : [],

      items: order.order_details.map((item) => ({
        order_detail_id: item.order_detail_id,
        quantity: item.quantity,
        original_price: Number(
          item.original_price || item.product_variant.product.price
        ),
        price: Number(item.price),
        is_review: !!item.review,
        product: {
          product_id: item.product_variant.product.product_id,
          name: item.product_variant.product.name,
          thumbnail: item.product_variant.product.thumbnail,
        },
        variant: {
          product_variant_id:
            item.product_variant.product_variant_id,
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
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};



const cancelOrder = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { order_id } = req.params;
    const { reason } = req.body;
    const { user_id } = req.user;

    if (!reason) {
      return res
        .status(400)
        .json({ message: "Vui lòng chọn lý do hủy đơn hàng" });
    }

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
      return res.status(404).json({
        message: "Đơn hàng không tồn tại hoặc không thuộc quyền của bạn",
      });
    }

    if (
      order.payment &&
      order.payment.some(
        (p) => p.method === "MOMO" && p.status === "thành công"
      )
    ) {
      await t.rollback();
      return res.status(400).json({
        message: "Đơn hàng thanh toán bằng MOMO đã thành công, không thể hủy.",
      });
    }

    const allowed = ["chờ xác nhận", "đã xác nhận", "đang xử lý", "đang giao"];
    if (!allowed.includes(order.status)) {
      await t.rollback();
      return res.status(400).json({
        message: `Đơn hàng đang ở trạng thái "${order.status}", không thể hủy`,
      });
    }

    await order.update({ status: "đã hủy" }, { transaction: t });

    if (order.payment && order.payment.length > 0) {
      for (const p of order.payment) {
        if (p.status !== "thành công") {
          await p.update({ status: "thất bại" }, { transaction: t });
        }
      }
    }

    await model.reason_cancel.create(
      { order_id: order.order_id, reason: reason.trim() },
      { transaction: t }
    );

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

    const { rows: orders } = await model.orders.findAndCountAll({
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
          attributes: ["payment_id", "method", "status", "payment_date"],
        },
        {
          model: model.promotion_usages,
          as: "promotion_usage",
          include: [
            {
              model: model.promotions,
              as: "promotion",
              attributes: [
                "promotion_id",
                "discount_type",
                "value",
                "max_discount",
              ],
            },
          ],
        },
      ],
    });

    const formatted = await Promise.all(
      orders.map(async (order) => {
        
        const hasMomoPayment =
          order.payment?.some((p) => p.method === "MOMO") || false;

        const hasSuccessPayment =
          order.payment?.some((p) => p.status === "thành công") || false;

        const expired =
          Date.now() - new Date(order.order_date).getTime() >
          15 * 60 * 1000;

        if (
          order.status === "chờ xác nhận" &&
          hasMomoPayment &&
          !hasSuccessPayment &&
          expired
        ) {
          await cancelOrderAndRestoreStock(order.order_id);
          order.status = "đã hủy"; 
        }

       
        const latestPayment = (order.payment || []).sort(
          (a, b) => b.payment_id - a.payment_id
        )[0];

       
        let discount_amount = 0;
        const promoUsage = order.promotion_usage;

        if (promoUsage && promoUsage.promotion) {
          const promo = promoUsage.promotion;
          const totalBeforePromo = order.order_details.reduce(
            (sum, item) => sum + Number(item.price) * item.quantity,
            0
          );

          if (promo.discount_type === "fixed") {
            discount_amount = Number(promo.value);
          } else if (promo.discount_type === "percent") {
            discount_amount =
              (totalBeforePromo * Number(promo.value)) / 100;

            if (promo.max_discount) {
              discount_amount = Math.min(
                discount_amount,
                Number(promo.max_discount)
              );
            }
          }
        }

        return {
          order_id: order.order_id,
          status: order.status,
          order_date: formatVNDateTime(order.order_date),
          total: parseFloat(order.total || 0),
          discount_amount,
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

          payment: latestPayment
            ? {
                method: latestPayment.method,
                status: latestPayment.status,
                payment_date: latestPayment.payment_date
                  ? formatVNDateTime(latestPayment.payment_date)
                  : null,
              }
            : null,

          items: (order.order_details || []).map((detail) => ({
            product_id: detail.product_variant.product.product_id,
            name: detail.product_variant.product.name,
            thumbnail: detail.product_variant.product.thumbnail,
            product_variant_id:
              detail.product_variant.product_variant_id,
            color: detail.product_variant.color,
            size: detail.product_variant.size || null,
            sku: detail.product_variant.sku,
            quantity: detail.quantity,
            price_original: parseFloat(detail.original_price || 0),
            final_price: parseFloat(detail.price || 0),
          })),
        };
      })
    );

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
  const t = await sequelize.transaction();
  try {
    const { order_id } = req.params;
    const { status: requestedStatus } = req.body;

    const order = await model.orders.findByPk(order_id, {
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
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }

    const hasMomo = (order.payment || []).some((p) => p.method === "MOMO");

    const momoPaid = (order.payment || []).some(
      (p) => p.method === "MOMO" && p.status === "thành công"
    );

    if (hasMomo && !momoPaid) {
      await t.rollback();
      return res.status(400).json({
        message:
          "Đơn hàng chưa thanh toán MOMO thành công, không thể cập nhật trạng thái",
      });
    }

    const previousStatus = order.status;

    const allowedTransitions = {
      "chờ xác nhận": ["đã xác nhận"],
      "đã xác nhận": ["đang xử lý"],
      "đang xử lý": ["đang giao"],
      "đang giao": ["đã giao", "giao thất bại"],
      "giao thất bại": [],
      "đã giao": ["đổi hàng"],
      "đổi hàng": [],
    };

    if (!allowedTransitions[previousStatus]) {
      await t.rollback();
      return res.status(400).json({ message: "Trạng thái không hợp lệ" });
    }

    let newStatus;

    if (previousStatus === "đang giao") {
      if (!allowedTransitions[previousStatus].includes(requestedStatus)) {
        await t.rollback();
        return res.status(400).json({
          message:
            'Khi trạng thái là "đang giao" chỉ được chuyển sang "đã giao" hoặc "giao thất bại"',
        });
      }
      newStatus = requestedStatus;
    } else {
      newStatus = allowedTransitions[previousStatus][0];
    }

    if (newStatus === "đã giao") {
      order.received_date = new Date();

      for (const p of order.payment || []) {
        if (p.method === "COD") {
          await p.update(
            {
              status: "thành công",
              payment_date: new Date(),
            },
            { transaction: t }
          );
        }
      }
    }

    if (["giao thất bại", "đổi hàng"].includes(newStatus)) {
      for (const p of order.payment || []) {
        if (p.status !== "thành công") {
          await p.update(
            { status: "thất bại", payment_date: null },
            { transaction: t }
          );
        }
      }

      for (const detail of order.order_details) {
        await detail.product_variant.increment("stock", {
          by: detail.quantity,
          transaction: t,
        });
      }
    }

    await order.update(
      { status: newStatus, received_date: order.received_date },
      { transaction: t }
    );

    await t.commit();

    return res.json({
      message: "Cập nhật trạng thái thành công",
      data: {
        order_id: order.order_id,
        new_status: newStatus,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Lỗi updateOrderStatus:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const reorderCart = async (req, res) => {
  try {
    const user_id = req.user?.user_id;
    const { order_detail_id } = req.params;

    if (!user_id) {
      return res.status(401).json({ message: "Không tìm thấy người dùng" });
    }

    
    const orderDetail = await model.order_details.findOne({
      where: { order_detail_id },
      include: [
        {
          model: model.orders,
          as: "order",
          where: { user_id },
          attributes: ["order_id", "status"],
        },
        {
          model: model.product_variants,
          as: "product_variant",
          attributes: ["product_variant_id", "stock", "color", "size", "sku"],
          include: [
            {
              model: model.products,
              as: "product",
              attributes: ["product_id", "name", "thumbnail", "status"],
            },
          ],
        },
      ],
    });

    if (!orderDetail) {
      return res.status(404).json({
        message:
          "Không thể mua lại sản phẩm (đơn không tồn tại hoặc không thuộc người dùng)",
      });
    }

   
    const allowedStatuses = ["đã giao", "giao thất bại", "đã hủy", "đổi hàng"];
    if (!allowedStatuses.includes(orderDetail.order.status)) {
      return res.status(400).json({
        message: "Chỉ được mua lại sản phẩm từ đơn đã hoàn tất hoặc bị hủy",
      });
    }

    const variant = orderDetail.product_variant;

   
    if (!variant) {
      return res.status(400).json({
        message: "Sản phẩm không còn tồn tại",
      });
    }

 
    const product = variant.product;
    if (!product) {
      return res.status(400).json({
        message: "Sản phẩm khôn còn tồn tại",
      });
    }

  
    if (product.status !== "đang bán") {
      return res.status(400).json({
        message: "Sản phẩm hiện đã ngưng bán",
      });
    }

   
    const stock = Number(variant.stock ?? 0);
    if (stock <= 0) {
      return res.status(400).json({
        message: "Sản phẩm hiện đã hết hàng",
      });
    }

   
    let cart = await model.carts.findOne({ where: { user_id } });
    if (!cart) {
      cart = await model.carts.create({ user_id });
    }

    const variantId = variant.product_variant_id;

    let cartDetail = await model.cart_details.findOne({
      where: { cart_id: cart.cart_id, product_variant_id: variantId },
    });

    if (cartDetail) {
      const newQuantity = cartDetail.quantity + 1;

      if (newQuantity > 10) {
        return res.status(400).json({
          message: "Mỗi sản phẩm chỉ được tối đa 10 trong giỏ hàng",
        });
      }

      if (newQuantity > stock) {
        return res.status(400).json({
          message: `Không đủ hàng (chỉ còn ${stock} sản phẩm)`,
        });
      }

      cartDetail.quantity = newQuantity;
      await cartDetail.save();
    } else {
      cartDetail = await model.cart_details.create({
        cart_id: cart.cart_id,
        product_variant_id: variantId,
        quantity: 1,
      });
    }

    return res.status(200).json({
      message: "Mua lại sản phẩm thành công",
      data: {
        cart_id: cart.cart_id,
        product_variant_id: variantId,
        product_name: product.name,
        thumbnail: product.thumbnail,
        color: variant.color,
        size: variant.size,
        quantity: cartDetail.quantity,
      },
    });
  } catch (error) {
    console.error("Lỗi reorderCartByOrderDetail:", error);
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

    if (status) userFilter.status = status;

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;

    const count = await model.orders.count({ where: userFilter });
    const totalPages = Math.ceil(count / pageSize);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

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
        {
          model: model.promotion_usages,
          as: "promotion_usage",
          include: [{ model: model.promotions, as: "promotion" }],
          required: false,
        },
        {
          model: model.payments,
          as: "payment",
          attributes: ["payment_id", "method", "status", "payment_date"],
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

    const now = Date.now();
    const formatted = [];

    for (const order of orders) {
      const hasMomoPayment =
        order.payment?.some((p) => p.method === "MOMO") || false;

      const hasSuccessPayment =
        order.payment?.some((p) => p.status === "thành công") || false;

      const expired =
        now - order.order_date.getTime() > 15 * 60 * 1000;

      if (
        order.status === "chờ xác nhận" &&
        hasMomoPayment &&
        !hasSuccessPayment &&
        expired
      ) {
        await cancelOrderAndRestoreStock(order.order_id);
        order.status = "đã hủy";
      }

   
      const latestPayment = (order.payment || []).sort(
        (a, b) => b.payment_id - a.payment_id
      )[0];

      let discount_amount = 0;
      if (order.promotion_usage && order.promotion_usage.promotion) {
        const promotion = order.promotion_usage.promotion;

        const totalBeforePromo = order.order_details.reduce(
          (sum, d) => sum + Number(d.price) * d.quantity,
          0
        );

        if (promotion.discount_type === "fixed") {
          discount_amount = Number(promotion.value);
        } else if (promotion.discount_type === "percent") {
          discount_amount =
            totalBeforePromo * (Number(promotion.value) / 100);

          if (promotion.max_discount) {
            discount_amount = Math.min(
              discount_amount,
              Number(promotion.max_discount)
            );
          }
        }
      }

      const items = order.order_details.map((detail) => ({
        product_id: detail.product_variant.product.product_id,
        name: detail.product_variant.product.name,
        thumbnail: detail.product_variant.product.thumbnail,
        product_variant_id: detail.product_variant.product_variant_id,
        color: detail.product_variant.color,
        size: detail.product_variant.size,
        sku: detail.product_variant.sku,
        quantity: detail.quantity,
        price_original: Number(detail.original_price || 0),
        final_price: Number(detail.price || 0),
      }));

      formatted.push({
        order_id: order.order_id,
        user_id: order.user_id,
        status: order.status,
        order_date: formatVNDateTime(order.order_date),
        total: Number(order.total),
        discount_amount,
        payment: latestPayment
          ? {
            method: latestPayment.method,
            status: latestPayment.status,
            payment_date: latestPayment.payment_date
              ? formatVNDateTime(latestPayment.payment_date)
              : null,
          }
          : null,
        items,
      });
    }

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




export {
  placeDirectOrder,
  placeCartOrder,
  getOrderDetail,
  cancelOrder,
  getAllOrders,
  updateOrderStatus,
  reorderCart,
  getOrdersByStatus,
};
