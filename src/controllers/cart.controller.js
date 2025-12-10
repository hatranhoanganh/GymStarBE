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

const addToCart = async (req, res) => {
  try {
    const user_id = req.user?.user_id; 
    const { product_variant_id } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!product_variant_id)
      return res.status(400).json({ message: "Thiếu product_variant_id" });

    const user = await model.users.findByPk(user_id);
    if (!user)
      return res.status(404).json({ message: "Người dùng không tồn tại" });

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

    if (variant.stock <= 0)
      return res.status(400).json({ message: "Sản phẩm đã hết hàng" });

    let cartItem = await model.carts.findOne({
      where: { user_id, product_variant_id },
    });

    if (cartItem) {
      if (cartItem.quantity >= 10)
        return res.status(400).json({ message: "Số lượng tối đa là 10" });

      if (cartItem.quantity + 1 > variant.stock)
        return res.status(400).json({ message: "Không đủ hàng trong kho" });

      cartItem.quantity += 1;
      await cartItem.save();

      const fullCartItem = await model.carts.findByPk(cartItem.cart_id, {
        include: [
          {
            model: model.product_variants,
            as: "product_variant",
            include: [
              {
                model: model.products,
                as: "product",
                attributes: ["product_id", "name", "thumbnail", "price", "discount"],
              },
            ],
          },
          {
            model: model.users,
            as: "user",
            include: [
              {
                model: model.roles,
                as: "role",
                attributes: ["role_id", "role_name"],
              },
            ],
          },
        ],
      });

      return res.status(200).json({
        message: "Đã tăng số lượng trong giỏ hàng",
        data: formatCartItem(fullCartItem),
      });
    }

    const newCart = await model.carts.create({
      user_id,
      product_variant_id,
      quantity: 1,
    });

    const fullCartItem = await model.carts.findByPk(newCart.cart_id, {
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [
            {
              model: model.products,
              as: "product",
              attributes: ["product_id", "name", "thumbnail", "price", "discount"],
            },
          ],
        },
        {
          model: model.users,
          as: "user",
          include: [
            {
              model: model.roles,
              as: "role",
              attributes: ["role_id", "role_name"],
            },
          ],
        },
      ],
    });

    return res.status(201).json({
      message: "Thêm vào giỏ hàng thành công",
      data: formatCartItem(fullCartItem),
    });

  } catch (error) {
    console.error("Lỗi thêm giỏ hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const getCart = async (req, res) => {
  try {
    const user_id = req.user?.user_id; 

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    const user = await model.users.findByPk(user_id, {
      attributes: ["user_id", "full_name", "email", "gender", "birth_date"],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
    });

    if (!user)
      return res.status(404).json({ message: "Người dùng không tồn tại" });

    const cartItems = await model.carts.findAll({
      where: { user_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          attributes: [
            "product_variant_id",
            "product_id",
            "color",
            "size",
            "stock",
            "sku",
          ],
          include: [
            {
              model: model.products,
              as: "product",
              attributes: ["product_id", "name", "price", "discount"],
            },
          ],
        },
      ],
      order: [["createdAt", "ASC"]],
    });

    if (!cartItems.length) {
      return res.status(200).json({
        message: "Giỏ hàng trống",
        user: {
          ...user.dataValues,
          birth_date: formatVNDate(user.birth_date),
        },
        data: [],
      });
    }

    const formattedCart = cartItems.map((item) => {
      const product = item.product_variant.product;
      const price = Number(product.price);
      const discount = Number(product.discount) || 0;

      const raw_price = price * (1 - discount / 100);
      const final_price = Math.round(raw_price);
      const final_price_display = final_price.toFixed(2);

      return {
        cart_id: item.cart_id,
        quantity: item.quantity,
        createdAt: formatVNDateTime(item.createdAt),
        updatedAt: formatVNDateTime(item.updatedAt),

        product_variant: {
          product_variant_id: item.product_variant.product_variant_id,
          color: item.product_variant.color,
          size: item.product_variant.size,
          stock: item.product_variant.stock,
          sku: item.product_variant.sku,

          product: {
            product_id: product.product_id,
            name: product.name,
            price: price,
            discount: discount,
            final_price: final_price_display,
          },
        },
      };
    });

    return res.status(200).json({
      message: "Lấy giỏ hàng thành công",
      user: {
        ...user.dataValues,
        birth_date: formatVNDate(user.birth_date),
      },
      data: formattedCart,
    });
  } catch (error) {
    console.error("Lỗi lấy giỏ hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const updateCartQuantity = async (req, res) => {
  try {
    const user_id = req.user?.user_id; 
    const { product_variant_id, change } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!product_variant_id || change == null)
      return res
        .status(400)
        .json({ message: "Thiếu product_variant_id hoặc change" });

    let cartItem = await model.carts.findOne({
      where: { user_id, product_variant_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [{ model: model.products, as: "product" }],
        },
        {
          model: model.users,
          as: "user",
          include: [{ model: model.roles, as: "role" }],
        },
      ],
    });

    if (!cartItem)
      return res
        .status(404)
        .json({ message: "Sản phẩm không có trong giỏ hàng" });

    const variant = cartItem.product_variant;

    if (variant.stock === 0)
      return res.status(400).json({ message: "Sản phẩm đã hết hàng" });

  
    if (change === 1 || change === +1) {
      if (cartItem.quantity >= 10)
        return res.status(400).json({ message: "Số lượng tối đa là 10" });

      if (cartItem.quantity + 1 > variant.stock)
        return res.status(400).json({ message: "Không đủ hàng trong kho" });

      cartItem.quantity += 1;
    }


    if (change === -1) {
      if (cartItem.quantity <= 1)
        return res.status(400).json({ message: "Số lượng tối thiểu là 1" });

      cartItem.quantity -= 1;
    }

    await cartItem.save();

    const fullCartItem = await model.carts.findByPk(cartItem.cart_id, {
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [{ model: model.products, as: "product" }],
        },
        {
          model: model.users,
          as: "user",
          include: [{ model: model.roles, as: "role" }],
        },
      ],
    });

    return res.status(200).json({
      message: "Cập nhật số lượng thành công",
      data: formatCartItem(fullCartItem),
    });
  } catch (error) {
    console.error("Lỗi updateCartQuantity:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const setCartQuantity = async (req, res) => {
  try {
    const user_id = req.user?.user_id; 
    const { product_variant_id, quantity } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!product_variant_id || quantity == null)
      return res.status(400).json({
        message: "Thiếu product_variant_id hoặc quantity",
      });

    const finalQuantity = parseInt(quantity);

    if (isNaN(finalQuantity) || finalQuantity < 1)
      return res
        .status(400)
        .json({ message: "Số lượng phải là số nguyên >= 1" });

    let cartItem = await model.carts.findOne({
      where: { user_id, product_variant_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [{ model: model.products, as: "product" }],
        },
        {
          model: model.users,
          as: "user",
          include: [{ model: model.roles, as: "role" }],
        },
      ],
    });

    if (!cartItem)
      return res
        .status(404)
        .json({ message: "Sản phẩm không có trong giỏ hàng" });

    const variant = cartItem.product_variant;

    if (variant.stock === 0)
      return res.status(400).json({ message: "Sản phẩm đã hết hàng" });

    if (finalQuantity > 10)
      return res.status(400).json({ message: "Số lượng chỉ tối đa là 10" });

    if (finalQuantity > variant.stock)
      return res.status(400).json({ message: "Không đủ hàng trong kho" });

    cartItem.quantity = finalQuantity;
    await cartItem.save();

    const fullCartItem = await model.carts.findByPk(cartItem.cart_id, {
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [{ model: model.products, as: "product" }],
        },
        {
          model: model.users,
          as: "user",
          include: [{ model: model.roles, as: "role" }],
        },
      ],
    });

    return res.status(200).json({
      message: "Cập nhật số lượng thành công",
      data: formatCartItem(fullCartItem),
    });
  } catch (error) {
    console.error("Lỗi setCartQuantity:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const deleteCartItem = async (req, res) => {
  try {
    const user_id = req.user?.user_id; 
    const { cart_id } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!cart_id) {
      return res.status(400).json({ message: "Thiếu cart_id" });
    }

    const deleted = await model.carts.destroy({
      where: {
        cart_id,
        user_id, // đảm bảo chỉ xóa giỏ của user đang đăng nhập
      },
    });

    if (!deleted) {
      return res.status(404).json({
        message: "Không tìm thấy sản phẩm trong giỏ hàng",
      });
    }

    return res.status(200).json({
      message: "Xoá sản phẩm khỏi giỏ hàng thành công",
    });
  } catch (err) {
    console.error("Lỗi deleteCartItem:", err);
    return res.status(500).json({ message: "Lỗi server" });
  }
};


const deleteMultipleCartItems = async (req, res) => {
  try {
    const user_id = req.user?.user_id; 
    const { cart_ids } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!Array.isArray(cart_ids) || cart_ids.length === 0) {
      return res.status(400).json({
        message: "Danh sách cart_ids không hợp lệ",
      });
    }

    const deletedCount = await model.carts.destroy({
      where: {
        cart_id: cart_ids,
        user_id: user_id, 
      },
    });

    if (deletedCount === 0) {
      return res.status(404).json({
        message: "Không tìm thấy sản phẩm nào để xoá",
      });
    }

    return res.status(200).json({
      message: "Xoá nhiều sản phẩm thành công",
      deleted: deletedCount,
    });
  } catch (error) {
    console.error("Lỗi xoá nhiều:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export {
  addToCart,
  getCart,
  updateCartQuantity,
  setCartQuantity,
  deleteCartItem,
  deleteMultipleCartItems,
};
