import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime, formatVNDate } from "../utils/dateFormat.js";
import { Op } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const placeDirectOrder = async (req, res) => {
  const t = await sequelize.transaction(); // mở transaction
  try {
    const { user_id } = req.params;
    const {
      product_variant_id,
      quantity = 1,
      note,
      address_id,
      method,
    } = req.body;

    if (!product_variant_id)
      return res.status(400).json({ message: "Thiếu product_variant_id" });

    if (!method)
      return res
        .status(400)
        .json({ message: "Vui lòng chọn phương thức thanh toán" });

    const finalQuantity = parseInt(quantity);
    if (isNaN(finalQuantity) || finalQuantity < 1)
      return res.status(400).json({ message: "Số lượng phải >= 1" });

    // kiểm tra user
    const user = await model.users.findByPk(user_id);
    if (!user)
      return res.status(404).json({ message: "Người dùng không tồn tại" });

    // lấy địa chỉ giao hàng
    let address;
    if (address_id) {
      address = await model.user_addresses.findOne({
        where: { address_id, user_id },
      });
      if (!address)
        return res.status(404).json({ message: "Địa chỉ không tồn tại" });
    } else {
      address = await model.user_addresses.findOne({
        where: { user_id, is_default: true },
      });
      if (!address)
        return res
          .status(400)
          .json({ message: "Người dùng chưa có địa chỉ mặc định" });
    }

    // lấy variant + product
    const variant = await model.product_variants.findByPk(product_variant_id, {
      include: [
        {
          model: model.products,
          as: "product",
          attributes: ["product_id", "name", "thumbnail", "price", "discount"],
        },
      ],
    });

    if (!variant)
      return res
        .status(404)
        .json({ message: "Biến thể sản phẩm không tồn tại" });

    if (variant.stock < finalQuantity)
      return res.status(400).json({ message: "Không đủ hàng trong kho" });

    // tính giá
    const price = Number(variant.product.price);
    const discount = Number(variant.product.discount) || 0;
    const finalPrice = Number((price * (1 - discount / 100)).toFixed(2));

    const totalAmount = Number((finalPrice * finalQuantity).toFixed(2));

    // tạo order
    const newOrder = await model.orders.create(
      {
        user_id,
        total: totalAmount,
        note,
        receiver_name: address.receiver_name,
        phone: address.phone,
        address_detail: address.address_detail,
        received_date: null,
        status: "chờ xác nhận",
      },
      { transaction: t }
    );

    // tạo order_detail
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

    // set status payment bằng IF-ELSE
    let paymentStatus;

    if (method === "COD") {
      paymentStatus = "đang chờ";
    } else if (method === "MOMO") {
      paymentStatus = "đang chờ"; // khi tích hợp momo, status có thể thành "đang chờ thanh toán"
    } else if (method === "VNPAY") {
      paymentStatus = "đang chờ";
    } else {
      return res
        .status(400)
        .json({ message: "Phương thức thanh toán không hợp lệ" });
    }

    // tạo payment
    await model.payments.create(
      {
        order_id: newOrder.order_id,
        method: method,
        total: totalAmount,
        status: paymentStatus,
        payment_date: method === "COD" ? null : new Date(),
      },
      { transaction: t }
    );

    // trừ stock
    variant.stock -= finalQuantity;
    await variant.save({ transaction: t });

    await t.commit();

    return res.status(201).json({
      message: "Đặt hàng thành công",
      order: {
        order_id: newOrder.order_id,
        user_id: newOrder.user_id,
        order_date: formatVNDateTime(newOrder.order_date),
        receiver_name: newOrder.receiver_name,
        phone: newOrder.phone,
        address_detail: newOrder.address_detail,
        note: newOrder.note,
        total: newOrder.total,
        status: newOrder.status,
        payment: {
          method,
          status: paymentStatus,
          total: totalAmount,
        },
        order_details: [
          {
            product: {
              product_id: variant.product.product_id,
              name: variant.product.name,
              thumbnail: variant.product.thumbnail,
            },
            product_variant_id: variant.product_variant_id,
            color: variant.color,
            size: variant.size,
            sku: variant.sku,
            quantity: finalQuantity,
            original_price: price,
            discount,
            final_price: finalPrice,
          },
        ],
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("Lỗi placeDirectOrder:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const placeCartOrder = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { cart_item_ids, address_id, note, method } = req.body;

    // Validate param
    if (!user_id) {
      return res.status(400).json({ message: "Thiếu user_id trong URL" });
    }

    if (
      !cart_item_ids ||
      !Array.isArray(cart_item_ids) ||
      cart_item_ids.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Vui lòng chọn sản phẩm cần đặt hàng" });
    }

    if (!method) {
      return res
        .status(400)
        .json({ message: "Vui lòng chọn phương thức thanh toán" });
    }

    if (method !== "COD") {
      return res.status(400).json({
        message: "Phương thức thanh toán không hợp lệ (chỉ hỗ trợ COD)",
      });
    }

    // =============================
    // LẤY ĐỊA CHỈ GIAO HÀNG
    // =============================
    let address;

    if (address_id) {
      address = await model.user_addresses.findOne({
        where: { address_id, user_id },
      });

      if (!address) {
        return res
          .status(404)
          .json({ message: "Địa chỉ giao hàng không tồn tại" });
      }
    } else {
      address = await model.user_addresses.findOne({
        where: { user_id, is_default: true },
      });

      if (!address) {
        return res.status(400).json({
          message:
            "Người dùng chưa có địa chỉ mặc định, vui lòng chọn địa chỉ giao hàng",
        });
      }
    }

    // =============================
    // LẤY CART ITEMS
    // =============================
    const cartItems = await model.carts.findAll({
      where: {
        cart_id: cart_item_ids,
        user_id,
      },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [{ model: model.products, as: "product" }],
        },
      ],
    });

    if (cartItems.length === 0) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy sản phẩm trong giỏ hàng" });
    }

    // =============================
    // TÍNH TỔNG TIỀN (Đã format 2 số)
    // =============================
    let total = 0;

    for (const item of cartItems) {
      const p = item.product_variant.product;
      const priceOriginal = Number(Number(p.price).toFixed(2));
      const discount = Number(Number(p.discount).toFixed(2));
      const final = Number((priceOriginal * (1 - discount / 100)).toFixed(2));

      total += final * item.quantity;
    }

    total = Number(total.toFixed(2));

    // =============================
    // TẠO ORDER
    // =============================
    const order = await model.orders.create({
      user_id,
      receiver_name: address.receiver_name,
      phone: address.phone,
      address_detail: address.address_detail,
      received_date: null,
      note,
      total,
      status: "chờ xác nhận",
    });

    // =============================
    // TẠO ORDER DETAILS (Đã format giá)
    // =============================
    const detailList = cartItems.map((item) => {
      const p = item.product_variant.product;
      const originalPrice = Number(p.price);
      const discount = Number(Number(p.discount).toFixed(2));
      const finalPrice = Number(
        (originalPrice * (1 - discount / 100)).toFixed(2)
      );

      return {
        order_id: order.order_id,
        product_variant_id: item.product_variant_id,
        quantity: item.quantity,

        original_price: originalPrice,
        discount,

        price: finalPrice, // cột NOT NULL
      };
    });

    await model.order_details.bulkCreate(detailList);

    // =============================
    // TẠO PAYMENT
    // =============================
    const paymentStatus = "đang chờ";

    await model.payments.create({
      order_id: order.order_id,
      method,
      status: paymentStatus,
      total,
      payment_date: method === "COD" ? null : new Date(),
    });

    // =============================
    // XÓA CART ITEMS
    // =============================
    await model.carts.destroy({
      where: { cart_id: cart_item_ids, user_id },
    });

    // =============================
    // FORMAT RESPONSE GIỐNG placeDirectOrder
    // =============================
    const orderDetailsFormatted = cartItems.map((item) => {
      const p = item.product_variant.product;
      const priceOriginal = Number(Number(p.price).toFixed(2));
      const discount = Number(Number(p.discount).toFixed(2));
      const finalPrice = Number(
        (priceOriginal * (1 - discount / 100)).toFixed(2)
      );

      return {
        product: {
          product_id: p.product_id,
          name: p.name,
          thumbnail: p.thumbnail,
        },
        product_variant_id: item.product_variant_id,
        color: item.product_variant.color,
        size: item.product_variant.size,
        sku: item.product_variant.sku,
        quantity: item.quantity,
        original_price: priceOriginal,
        discount,
        final_price: finalPrice,
      };
    });

    return res.json({
      message: "Đặt hàng thành công",
      order: {
        order_id: order.order_id,
        user_id: order.user_id,
        order_date: formatVNDateTime(order.order_date),
        receiver_name: order.receiver_name,
        phone: order.phone,
        address_detail: order.address_detail,
        note: order.note,
        total,
        status: order.status,
        payment: {
          method,
          status: paymentStatus,
          total,
        },
        order_details: orderDetailsFormatted,
      },
    });
  } catch (error) {
    console.error("Lỗi placeOrderFromCart:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const getOrdersByStatus = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    // Xác định role người dùng (User / Admin)
    const role = req.user.role; // giả sử bạn dùng middleware auth
    let userFilter = {};

    if (role === "user") {
      // User chỉ được xem đơn của chính họ
      userFilter.user_id = req.user.user_id;
    } else if (role === "admin") {
      // Admin có thể xem tất cả, hoặc filter theo user_id
      if (req.query.user_id) userFilter.user_id = req.query.user_id;
    } else {
      return res.status(403).json({ message: "Không có quyền truy cập" });
    }

    // Thêm filter trạng thái
    if (status) userFilter.status = status;

    // ... phần phân trang giống như ví dụ getOrdersByStatus trước
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

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
      ],
    });

    // Format dữ liệu như trước
    const formatted = orders.map((order) => {
      const items = order.order_details.map((detail) => {
        const p = detail.product_variant.product;
        const priceOriginal = Number(Number(p.price).toFixed(2));
        const discount = Number(Number(p.discount).toFixed(2));
        const finalPrice = Number(
          (priceOriginal * (1 - discount / 100)).toFixed(2)
        );

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

    const order = await model.orders.findOne({
      where: { order_id },
      attributes: {
        include: [
          "order_id",
          "order_date",
          "status",
          "total",
          "note",
          "receiver_name",
          "phone",
          "address_detail",
          "received_date",
        ],
      },
      include: [
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "gender", "status"],
        },
        {
          model: model.payments,
          as: "payments",
          attributes: [
            "payment_id",
            "method",
            "total",
            "status",
            "payment_date",
          ],
        },
        {
          model: model.order_details,
          as: "order_details",
          attributes: [
            "order_detail_id",
            "quantity",
            "price",
            "original_price",
          ],
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

      payments:
        order.payments?.map((p) => ({
          payment_id: p.payment_id,
          method: p.method,
          total: Number(p.total),
          status: p.status,
          payment_date: formatVNDateTime(p.payment_date) || null,
        })) || [],

      items: order.order_details.map((item) => ({
        order_detail_id: item.order_detail_id,
        quantity: item.quantity,

        original_price: Number(
          item.original_price || item.product_variant.product.price
        ),
        price: Number(item.price), // giá khách đã trả
        // Thông tin sản phẩm
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
    console.log("Lỗi getOrderDetail:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const cancelOrder = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { order_id } = req.params;
    const { reason } = req.body;

    // 1. Kiểm tra lý do có gửi lên không (FE bắt buộc chọn)
    if (!reason) {
      await t.rollback();
      return res.status(400).json({
        message: "Vui lòng chọn lý do hủy đơn hàng",
      });
    }

    // 2. Tìm đơn hàng + include cần thiết
    const order = await model.orders.findOne({
      where: { order_id: Number(order_id) },
      include: [
        {
          model: model.order_details,
          as: "order_details",
          attributes: ["quantity", "product_variant_id"],
          include: [
            {
              model: model.product_variants,
              as: "product_variant",
            },
          ],
        },
        {
          model: model.payments,
          as: "payment", // ← đã sửa đúng trong initModels
        },
      ],
      transaction: t,
    });

    if (!order) {
      await t.rollback();
      return res.status(404).json({ message: "Đơn hàng không tồn tại" });
    }

    // 3. Kiểm tra trạng thái được phép hủy
    const allowed = ["chờ xác nhận", "đã xác nhận", "đang xử lý"];
    if (!allowed.includes(order.status)) {
      await t.rollback();
      return res.status(400).json({
        message: `Đơn hàng đang ở trạng thái "${order.status}", không thể hủy`,
      });
    }

    // 4. Cập nhật trạng thái đơn hàng
    await order.update({ status: "đã hủy" }, { transaction: t });

    // 5. Cập nhật payment (nếu có)
    if (order.payment) {
      const updateData = { status: "thất bại" };
      if (order.payment.method === "COD") {
        updateData.payment_date = sequelize.fn("NOW");
      }
      await order.payment.update(updateData, { transaction: t });
    }

    // 6. Lưu lý do hủy – FE đã gửi đúng → không cần clean gì nữa
    // (Model đã có validate isIn → nếu sai sẽ tự throw → bắt ở catch dưới)
    await model.reason_cancel.create(
      {
        order_id: order.order_id,
        reason: reason.trim(), // chỉ trim nhẹ cho chắc, không cần normalize
      },
      { transaction: t }
    );

    // 7. Hoàn lại kho
    if (order.order_details?.length > 0) {
      for (const detail of order.order_details) {
        await detail.product_variant.increment("stock", {
          by: detail.quantity,
          transaction: t,
        });
      }
    }

    await t.commit();

    // RESPONSE SIÊU GỌN – CHỈ TRẢ VỀ ĐÚNG NHỮNG GÌ FE CẦN
    return res.json({
      message: "Hủy đơn hàng thành công!",
      data: {
        order_id: order.order_id,
        canceled_reason: reason.trim(),
      },
    });
  } catch (error) {
    await t.rollback();

    // Nếu lỗi validate lý do → trả 400 đẹp
    if (error.name === "SequelizeValidationError") {
      return res.status(400).json({
        message: "Lý do hủy không hợp lệ",
        validReasons: [
          "Đổi ý không muốn mua nữa",
          "Đặt nhầm sản phẩm/màu/size",
          "Tìm được chỗ khác rẻ hơn",
          "Thay đổi địa chỉ giao hàng",
          "Giao hàng quá lâu",
          "Muốn thay đổi phương thức thanh toán",
        ],
      });
    }

    console.error("Lỗi hủy đơn hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

function removeVietnameseTones(str) {
  if (!str) return "";
  str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // tách dấu
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
  // === CHỈ tìm chính xác order_id khi keyword LÀ SỐ THUẦN (không chứa ký tự nào khác) ===
  const isPureNumber = /^\d+$/.test(trimmedKeyword);
  if (isPureNumber) {
    const orderIdExact = parseInt(trimmedKeyword, 10);
    whereClause.order_id = orderIdExact; // Tìm chính xác bằng =
  } 
  // === Các trường hợp còn lại (có chữ, ký tự đặc biệt, số + chữ...) → tìm gần đúng ===
  else {
    const noToneKeyword = removeVietnameseTones(trimmedKeyword).toLowerCase();

    whereClause[Op.or] = [
      // Vẫn tìm order_id dạng text nếu có chứa số (vd: "DH3141", "3141abc")
      sequelize.where(
        sequelize.cast(sequelize.col("orders.order_id"), "TEXT"),
        { [Op.like]: `%${trimmedKeyword}%` }
      ),
      sequelize.where(
        sequelize.fn("LOWER", sequelize.fn("unaccent", sequelize.col("orders.receiver_name"))),
        { [Op.like]: `%${noToneKeyword}%` }
      ),
      { phone: { [Op.like]: `%${trimmedKeyword}%` } },
      sequelize.where(
        sequelize.fn("LOWER", sequelize.fn("unaccent", sequelize.col("orders.address_detail"))),
        { [Op.like]: `%${noToneKeyword}%` }
      ),
    ];
  }
}

    const totalCount = await model.orders.count({ where: whereClause });

    if (totalCount === 0) {
      return res.json({
        message: trimmedKeyword ? "Không tìm thấy đơn hàng nào" : "Không có đơn hàng nào",
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
        // Thông tin người đặt hàng
        {
          model: model.users,
          as: "user",
          attributes: ["user_id", "full_name", "email", "gender"],
        },
        // Chi tiết sản phẩm
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
        // Thanh toán
        {
          model: model.payments,
          as: "payment",
          attributes: ["method", "status", "payment_date"],
        },
      ],
    });

    // Format giống hệt getAllOrders
    const formatted = orders.map((order) => ({
      order_id: order.order_id,
      status: order.status,
      order_date: formatVNDateTime(order.order_date),
      total: parseFloat(order.total || 0),
      receiver_name: order.receiver_name ,
      phone: order.phone ,
      address_detail: order.address_detail ,
      note: order.note || null,

      user: {
            user_id: order.user.user_id,
            full_name: order.user.full_name ,
            email: order.user.email ,
            gender: order.user.gender ,
          },

      // Thanh toán – lấy thật từ DB, không fallback COD
        payment: {
    method: order.payment.method,
    status: order.payment.status,
    payment_date:formatVNDateTime(order.payment.payment_date)|| null,
  },

      items: (order.order_details || []).map((detail) => ({
        product_id: detail.product_variant.product.product_id,
        name: detail.product_variant.product.name,
        thumbnail: detail.product_variant.product.thumbnail,
        product_variant_id: detail.product_variant_id,
        color: detail.product_variant.color ,
        size: detail.product_variant.size || null,
        sku: detail.product_variant.sku ,
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

    // Đếm tổng số đơn hàng
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

    // Ép trang giống searchOrders
    const totalPages = Math.ceil(totalCount / limitNum);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * limitNum;

    // Query chính – lấy tất cả đơn hàng + thông tin user
    const { count, rows: orders } = await model.orders.findAndCountAll({
      limit: limitNum,
      offset,
      order: [["order_id", "DESC"]],
      include: [
        // Thông tin người đặt hàng
        {
          model: model.users,
          as: "user", // phải đúng alias trong model
          attributes: ["user_id", "full_name", "email", "gender"],
        },
        // Chi tiết sản phẩm
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
        // Thanh toán
        {
          model: model.payments,
          as: "payment",
          attributes: ["method", "status", "payment_date"],
        },
      ],
    });

    // Format dữ liệu giống hệt searchOrders + thêm user info
    const formatted = orders.map((order) => ({
      order_id: order.order_id,
      status: order.status,
      order_date: formatVNDateTime(order.order_date),
      total: parseFloat(order.total || 0),
      receiver_name: order.receiver_name ,
      phone: order.phone ,
      address_detail: order.address_detail ,
      note: order.note || null,

      // THÊM THÔNG TIN NGƯỜI DÙNG
      user: {
            user_id: order.user.user_id,
            full_name: order.user.full_name ,
            email: order.user.email ,
            gender: order.user.gender ,
          },

      // Thanh toán – lấy thật từ DB, không fallback COD
        payment: {
    method: order.payment.method,
    status: order.payment.status,
    payment_date:formatVNDateTime(order.payment.payment_date)|| null,
  },

      items: (order.order_details || []).map((detail) => ({
        product_id: detail.product_variant.product.product_id,
        name: detail.product_variant.product.name,
        thumbnail: detail.product_variant.product.thumbnail,
        product_variant_id: detail.product_variant_id,
        color: detail.product_variant.color ,
        size: detail.product_variant.size || null,
        sku: detail.product_variant.sku ,
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
    const { status } = req.body; // bắt buộc phải gửi trạng thái mới

    if (!status) {
      return res.status(400).json({ message: "Vui lòng chọn trạng thái mới" });
    }

    // Danh sách trạng thái hợp lệ
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
      "đang giao": ["đã giao", "giao thất bại"],           // chỉ 2 lựa chọn
      "giao thất bại": [],                        // chỉ được giao lại
      "đã giao": ["đổi hàng"],                             // chỉ được đổi hàng
      "đổi hàng": [],                                      // kết thúc, không chuyển tiếp
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

    // === XỬ LÝ KHI CHUYỂN SANG "ĐÃ GIAO" ===
    if (status === "đã giao") {
      order.received_date = new Date();
      order.payment.status = "thành công";
      order.payment.payment_date = new Date();
    }

    // === XỬ LÝ KHI "GIAO THẤT BẠI" HOẶC "ĐỔI HÀNG" ===
    if (status === "giao thất bại" || status === "đổi hàng") {
      order.payment.status = "thất bại";
      order.payment.payment_date = null; // hoặc giữ nguyên cũng được
    }

    // === HOÀN LẠI STOCK KHI ĐỔI HÀNG ===
    if (status === "đổi hàng"|| status === "giao thất bại") {
      for (const detail of order.order_details) {
        await detail.product_variant.increment("stock", {
          by: detail.quantity,
          transaction: t,
        });
      }
    }

    // === CẬP NHẬT TRẠNG THÁI ĐƠN HÀNG ===
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
