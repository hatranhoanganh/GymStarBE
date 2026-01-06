import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";

import { formatVNDate } from "../utils/dateFormat.js";

dotenv.config();
const model = initModels(sequelize);

const addToCart = async (req, res) => {
  let t;
  try {
    t = await sequelize.transaction();

    const user_id = req.user?.user_id;
    const { product_variant_id, quantity } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!product_variant_id)
      return res.status(400).json({ message: "Thiếu product_variant_id" });

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1)
      return res.status(400).json({ message: "Số lượng không hợp lệ" });

    if (qty > 10)
      return res.status(400).json({ message: "Số lượng tối đa là 10" });

    const variant = await model.product_variants.findByPk(product_variant_id, {
      transaction: t,
      lock: { level: t.LOCK.UPDATE, of: model.product_variants },
      include: [
        {
          model: model.products,
          as: "product",
          attributes: ["product_id", "name", "thumbnail", "discount","status",],
        },
      ],
    });

    if (!variant) {
      await t.rollback();
      return res
        .status(404)
        .json({ message: "Biến thể sản phẩm không tồn tại" });
    }
    if (!variant.product || variant.product.status !== "đang bán") {
      await t.rollback();
      return res.status(400).json({
        message: "Sản phẩm đã ngưng bán, không thể thêm vào giỏ hàng",
      });
    }

    if (variant.stock < 1) {
      await t.rollback();
      return res.status(400).json({ message: "Sản phẩm đã hết hàng" });
    }

    let cart = await model.carts.findOne({
      where: { user_id },
      transaction: t,
    });
    if (!cart) {
      cart = await model.carts.create({ user_id }, { transaction: t });
    }

    let cartDetail = await model.cart_details.findOne({
      where: { cart_id: cart.cart_id, product_variant_id },
      transaction: t,
    });

    if (cartDetail) {
      const newQuantity = cartDetail.quantity + qty;

      if (newQuantity > 10) {
        await t.rollback();
        return res.status(400).json({ message: "Mỗi sản phẩm tối đa 10 cái" });
      }

      if (newQuantity > variant.stock) {
        await t.rollback();
        return res.status(400).json({ message: "Không đủ hàng trong kho" });
      }

      cartDetail.quantity = newQuantity;
      await cartDetail.save({ transaction: t });
      await t.commit();

      return res.status(200).json({
        message: "Đã cập nhật số lượng trong giỏ hàng",
        data: cartDetail,
      });
    }

    if (qty > variant.stock) {
      await t.rollback();
      return res.status(400).json({ message: "Không đủ hàng trong kho" });
    }

    const newCartDetail = await model.cart_details.create(
      { cart_id: cart.cart_id, product_variant_id, quantity: qty },
      { transaction: t }
    );

    await t.commit();
    return res.status(201).json({
      message: "Thêm vào giỏ hàng thành công",
      data: newCartDetail,
    });
  } catch (error) {
    if (t && !t.finished) await t.rollback();
    console.error("Lỗi thêm giỏ hàng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getCart = async (req, res) => {
  try {
    const user_id = req.user?.user_id;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

   
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;


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

    
    const cart = await model.carts.findOne({
      where: { user_id },
      include: [
        {
          model: model.cart_details,
          as: "cart_details",
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
                "price",
                "sku",
              ],
              include: [
                {
                  model: model.products,
                  as: "product",
                  attributes: [
                    "product_id",
                    "name",
                    "discount",
                    "thumbnail",
                    "status",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!cart || !cart.cart_details.length) {
      return res.status(200).json({
        message: "Giỏ hàng trống",
        total: 0,
        page: 1,
        totalPages: 0,
        user: {
          ...user.dataValues,
          birth_date: formatVNDate(user.birth_date),
        },
        data: [],
      });
    }

   
    const activeCartItems = cart.cart_details.filter((item) => {
      const product = item.product_variant?.product;
      return product && product.status === "đang bán";
    });

    const count = activeCartItems.length;
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Giỏ hàng trống",
        total: 0,
        page: 1,
        totalPages: 0,
        user: {
          ...user.dataValues,
          birth_date: formatVNDate(user.birth_date),
        },
        data: [],
      });
    }


    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    
    const paginatedItems = activeCartItems.slice(
      offset,
      offset + pageSize
    );

   
    const formattedCart = paginatedItems.map((item) => {
      const variant = item.product_variant;
      const product = variant.product;

      const basePrice = Number(variant.price);
      const discountPercent = product.discount
        ? parseFloat(product.discount)
        : 0;

      const discountedPrice =
        discountPercent > 0
          ? basePrice * (1 - discountPercent / 100)
          : basePrice;

      const finalPrice = Math.round(discountedPrice / 1000) * 1000;

      return {
        cart_detail_id: item.cart_detail_id,
        quantity: item.quantity,
        cart_id: item.cart_id,
        product_variant: {
          product_variant_id: variant.product_variant_id,
          color: variant.color,
          size: variant.size,
          stock: variant.stock,
          sku: variant.sku,
          price: basePrice,
          product: {
            product_id: product.product_id,
            name: product.name,
            thumbnail: product.thumbnail,
            discount: discountPercent,
            final_price: finalPrice.toFixed(2),
          },
        },
      };
    });

    
    return res.status(200).json({
      message: "Lấy giỏ hàng thành công",
      total: count,
      page: validPage,
      totalPages,
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



const setCartQuantity = async (req, res) => {
  try {
    const user_id = req.user?.user_id;
    const { product_variant_id, quantity } = req.body;

    if (!user_id) {
      return res.status(401).json({
        message: "Không tìm thấy người dùng",
      });
    }

  
    if (!product_variant_id || quantity == null) {
      return res.status(400).json({
        message: "Thiếu product_variant_id hoặc quantity",
      });
    }

    const finalQuantity = parseInt(quantity);
    if (isNaN(finalQuantity) || finalQuantity < 1) {
      return res.status(400).json({
        message: "Số lượng phải là số nguyên >= 1",
      });
    }

    if (finalQuantity > 10) {
      return res.status(400).json({
        message: "Số lượng tối đa là 10",
      });
    }

   
    const cart = await model.carts.findOne({
      where: { user_id },
    });

    if (!cart) {
      return res.status(404).json({
        message: "Giỏ hàng không tồn tại",
      });
    }

    
    const cartDetail = await model.cart_details.findOne({
      where: {
        cart_id: cart.cart_id,
        product_variant_id,
      },
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          include: [
            {
              model: model.products,
              as: "product",
            },
          ],
        },
      ],
    });

    if (!cartDetail) {
      return res.status(404).json({
        message: "Sản phẩm không có trong giỏ hàng",
      });
    }

    const variant = cartDetail.product_variant;

   
    if (!variant) {
      return res.status(404).json({
        message: "Biến thể sản phẩm không tồn tại",
      });
    }

    const product = variant.product;

    
    if (!product) {
      return res.status(404).json({
        message: "Sản phẩm không tồn tại",
      });
    }

    
    if (product.status === "ngưng bán") {
      return res.status(400).json({
        message: "Sản phẩm đã ngưng bán, không thể cập nhật số lượng",
      });
    }

   
    if (variant.stock === 0) {
      return res.status(400).json({
        message: "Sản phẩm đã hết hàng",
      });
    }

    if (finalQuantity > variant.stock) {
      return res.status(400).json({
        message: "Không đủ hàng trong kho",
      });
    }


    cartDetail.quantity = finalQuantity;
    await cartDetail.save();

    
    const updatedCartDetail = await model.cart_details.findByPk(
      cartDetail.cart_detail_id,
      {
        include: [
          {
            model: model.product_variants,
            as: "product_variant",
            include: [
              {
                model: model.products,
                as: "product",
              },
            ],
          },
        ],
      }
    );

    return res.status(200).json({
      message: "Cập nhật số lượng thành công",
      data: updatedCartDetail,
    });
  } catch (error) {
    console.error("Lỗi setCartQuantity:", error);
    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};


const deleteCartItem = async (req, res) => {
  try {
    const user_id = req.user?.user_id;
    const { cart_detail_id } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!cart_detail_id) {
      return res.status(400).json({ message: "Thiếu cart_detail_id" });
    }

    const cart = await model.carts.findOne({ where: { user_id } });
    if (!cart)
      return res.status(404).json({ message: "Giỏ hàng không tồn tại" });

    await model.cart_details.destroy({
      where: {
        cart_id: cart.cart_id,
        cart_detail_id,
      },
    });

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
    const { cart_detail_ids } = req.body;

    if (!user_id)
      return res.status(401).json({ message: "Không tìm thấy người dùng" });

    if (!Array.isArray(cart_detail_ids) || cart_detail_ids.length === 0) {
      return res.status(400).json({
        message: "Danh sách cart_detail_ids không hợp lệ",
      });
    }

    const cart = await model.carts.findOne({ where: { user_id } });
    if (!cart)
      return res.status(404).json({ message: "Giỏ hàng không tồn tại" });

    await model.cart_details.destroy({
      where: {
        cart_id: cart.cart_id,
        cart_detail_id: cart_detail_ids,
      },
    });

    return res.status(200).json({
      message: "Xoá sản phẩm khỏi giỏ hàng thành công",
    });
  } catch (error) {
    console.error("Lỗi xoá nhiều:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};



export {
  addToCart,
  getCart,
  setCartQuantity,
  deleteCartItem,
  deleteMultipleCartItems,
};
