import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime,formatVNDate,formatCartItem } from "../utils/dateFormat.js";
import { Op, literal } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const addToCart = async (req, res) => {
  try {
    const user_id = req.params.user_id;
    const { product_variant_id, quantity } = req.body;

    if (!product_variant_id || quantity === undefined)
      return res.status(400).json({ message: "Thiếu dữ liệu" });

    if (!Number.isInteger(quantity) || quantity <= 0)
      return res.status(400).json({ message: "Số lượng không hợp lệ" });

    const user = await model.users.findByPk(user_id);
    if (!user) return res.status(404).json({ message: "Người dùng không tồn tại" });

    const variant = await model.product_variants.findByPk(product_variant_id, {
      include: [
        {
          model: model.products,
          as: "product",
          attributes: ["product_id", "name", "discount"],
        },
      ],
    });

    if (!variant) return res.status(404).json({ message: "Biến thể sản phẩm không tồn tại" });
    if (variant.stock === 0) return res.status(400).json({ message: "Sản phẩm đã hết hàng" });

    let cartItem = await model.carts.findOne({ where: { user_id, product_variant_id } });

    if (cartItem) {
      const newQuantity = cartItem.quantity + quantity;
      if (newQuantity > variant.stock)
        return res.status(400).json({ message: "Không đủ số lượng sản phẩm trong kho" });

      cartItem.quantity = newQuantity;
      await cartItem.save();

      return res.status(200).json({
        message: "Cập nhật giỏ hàng thành công",
        data: formatCartItem(cartItem, user.full_name),
      });
    }

    if (quantity > variant.stock)
      return res.status(400).json({ message: "Không đủ số lượng sản phẩm trong kho" });

    const newCart = await model.carts.create({ user_id, product_variant_id, quantity });

    return res.status(201).json({
      message: "Thêm vào giỏ hàng thành công",
      data: formatCartItem(newCart, user.full_name),
    });
  } catch (error) {
    console.error("Lỗi thêm giỏ hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const decreaseCartItem = async (req, res) => {
  try {
    const user_id = req.params.user_id;
    const { product_variant_id, quantity } = req.body;

    if (!product_variant_id || quantity === undefined)
      return res.status(400).json({ message: "Thiếu dữ liệu" });

    if (!Number.isInteger(quantity) || quantity <= 0)
      return res.status(400).json({ message: "Số lượng không hợp lệ" });

    const cartItem = await model.carts.findOne({
      where: { user_id, product_variant_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [{ model: model.products, as: "product", attributes: ["name", "discount"] }],
        },
        { model: model.users, as: "user", attributes: ["full_name"] },
      ],
    });

    if (!cartItem) return res.status(404).json({ message: "Sản phẩm không có trong giỏ hàng" });

    if (quantity > cartItem.quantity)
      return res.status(400).json({
        message: "Số lượng giảm không được lớn hơn số lượng hiện có trong giỏ hàng",
      });

    if (quantity === cartItem.quantity) {
      await cartItem.destroy();
      return res.status(200).json({ message: "Sản phẩm đã được xóa khỏi giỏ hàng" });
    }

    cartItem.quantity -= quantity;
    await cartItem.save();

    return res.status(200).json({
      message: "Cập nhật giỏ hàng thành công",
      data: formatCartItem(cartItem, cartItem.user?.full_name),
    });
  } catch (error) {
    console.error("Lỗi giảm số lượng giỏ hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getCart = async (req, res) => {
  try {
    const user_id = req.params.user_id;
    const user = await model.users.findByPk(user_id);
    if (!user) return res.status(404).json({ message: "Người dùng không tồn tại" });

    const cartItems = await model.carts.findAll({
      where: { user_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          attributes: ["product_variant_id", "color", "size", "price"],
          include: [{ model: model.products, as: "product", attributes: ["product_id", "name", "discount"] }],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    if (!cartItems.length) return res.status(200).json({ message: "Giỏ hàng trống", data: [] });

    const formattedData = cartItems.map((item) => formatCartItem(item, user.full_name));

    return res.status(200).json({ message: "Lấy giỏ hàng thành công", data: formattedData });
  } catch (error) {
    console.error("Lỗi lấy giỏ hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};



  


export {
  addToCart,
    decreaseCartItem,
    getCart,
};