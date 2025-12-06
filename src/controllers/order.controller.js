import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import {
  formatVNDateTime,
  formatVNDate,
} from "../utils/dateFormat.js";

dotenv.config();
const model = initModels(sequelize);

const placeDirectOrder = async (req, res) => {
 const t = await sequelize.transaction() // mở transaction
  try {
    const { user_id } = req.params;
    const { product_variant_id, quantity = 1, note, address_id, method } = req.body;

    if (!product_variant_id)
      return res.status(400).json({ message: "Thiếu product_variant_id" });

    if (!method)
      return res.status(400).json({ message: "Vui lòng chọn phương thức thanh toán" });

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
        return res.status(400).json({ message: "Người dùng chưa có địa chỉ mặc định" });
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
      return res.status(404).json({ message: "Biến thể sản phẩm không tồn tại" });

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
      return res.status(400).json({ message: "Phương thức thanh toán không hợp lệ" });
    }

    // tạo payment
    await model.payments.create(
      {
        order_id: newOrder.order_id,
        method: method,
        total: totalAmount,
        status: paymentStatus,
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
            price_original: price,
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

    // Validate cart items
    if (
      !cart_item_ids ||
      !Array.isArray(cart_item_ids) ||
      cart_item_ids.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Vui lòng chọn sản phẩm cần đặt hàng" });
    }

    // Validate method
    if (!method) {
      return res
        .status(400)
        .json({ message: "Vui lòng chọn phương thức thanh toán" });
    }

    if (method !== "COD") {
      return res
        .status(400)
        .json({ message: "Phương thức thanh toán không hợp lệ (chỉ hỗ trợ COD)" });
    }

    // =============================
    // LẤY ĐỊA CHỈ GIAO HÀNG
    // =============================
    let address;

    if (address_id) {
      // FE có chọn địa chỉ
      address = await model.user_addresses.findOne({
        where: { address_id, user_id },
      });

      if (!address) {
        return res.status(404).json({ message: "Địa chỉ giao hàng không tồn tại" });
      }
    } else {
      // Không chọn → lấy địa chỉ mặc định
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
    // TÍNH TỔNG TIỀN
    // =============================
    let total = 0;

    for (const item of cartItems) {
      const p = item.product_variant.product;
      const priceOriginal = Number(p.price);
      const discount = Number(p.discount);
      const final = Number((priceOriginal * (1 - discount / 100)).toFixed(2));

      total += final * item.quantity;
    }

    // =============================
    // TẠO ORDER
    // =============================
    const order = await model.orders.create({
      user_id,
      receiver_name: address.receiver_name,
      phone: address.phone,
      address_detail: address.address_detail,
      note,
      total: Number(total.toFixed(2)),
      status: "chờ xác nhận",
    });

    // =============================
    // TẠO ORDER DETAILS
    // =============================
    const detailList = cartItems.map((item) => {
  const p = item.product_variant.product;
  const priceOriginal = Number(p.price);
  const discount = Number(p.discount);
  const finalPrice = Number(
    (priceOriginal * (1 - discount / 100)).toFixed(2)
  );

  return {
    order_id: order.order_id,
    product_variant_id: item.product_variant_id,
    quantity: item.quantity,

    // Giá gốc + giảm giá
    price_original: priceOriginal,
    discount: discount,
    final_price: finalPrice,

    // 🔥 Thêm dòng này để fix lỗi NOT NULL
    price: finalPrice,
  };
});

    await model.order_details.bulkCreate(detailList);

    // =============================
    // TẠO PAYMENT
    // =============================
    let paymentStatus = "";

    if (method === "COD") {
      paymentStatus = "đang chờ";
    }

    await model.payments.create({
      order_id: order.order_id,
      method,
      status: paymentStatus,
      total: Number(total.toFixed(2)),
    });

    // =============================
    // XÓA CART ITEMS
    // =============================
    await model.carts.destroy({
      where: { cart_id: cart_item_ids, user_id },
    });

    // =============================
    // RESPONSE
    // =============================
    return res.json({
      message: "Đặt hàng thành công",
      order_id: order.order_id,
    });
  } catch (error) {
    console.error("Lỗi placeOrderFromCart:", error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};



export { placeDirectOrder, placeCartOrder };
