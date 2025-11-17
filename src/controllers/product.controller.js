import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, literal } from "sequelize";
import cloudinary from "../config/cloudinary.js";
import { promises as fs } from "fs";

dotenv.config();
const model = initModels(sequelize);

const addProduct = async (req, res) => {
  try {
    const {
      name,
      category_id,
      description = "",
      discount,
      spec,
      color,
      price,
      status = "active",
      has_size = true,
      product_variants,
    } = req.body;

    // ===== Kiểm tra thông tin cơ bản =====
    if (!name || !category_id || !color || price === undefined) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập đầy đủ thông tin sản phẩm" });
    }

    // Kiểm tra category tồn tại
    const category = await model.categories.findByPk(category_id);
    if (!category) {
      return res.status(400).json({ message: "Category không tồn tại" });
    }

    // Kiểm tra status hợp lệ
    const validStatus = ["active", "inactive", "draft"];
    if (!validStatus.includes(status)) {
      return res.status(400).json({ message: "Status không hợp lệ" });
    }

    // Kiểm tra discount
    let finalDiscount = 0;
    if (discount !== undefined && discount !== null) {
      if (typeof discount !== "number") {
        return res.status(400).json({ message: "Discount phải là số" });
      }
      if (discount <= 0 || discount >= 100) {
        return res.status(400).json({ message: "Discount phải > 0 và < 100" });
      }
      finalDiscount = discount;
    }

    // Kiểm tra price
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ message: "Price phải là số >= 0" });
    }

    // Kiểm tra product_variants
    if (!Array.isArray(product_variants) || product_variants.length === 0) {
      return res.status(400).json({ message: "Phải có ít nhất 1 variant" });
    }

    for (const v of product_variants) {
      if (has_size && !v.size) {
        return res.status(400).json({ message: "Variant phải có size" });
      }
      if (!v.stock && v.stock !== 0) {
        return res.status(400).json({ message: "Variant phải có stock" });
      }
      if (!v.sku) {
        return res.status(400).json({ message: "Variant phải có SKU" });
      }
    }

    // Kiểm tra SKU trùng
    const existingSkus = await model.product_variants.findAll({
      where: { sku: { [Op.in]: product_variants.map((v) => v.sku) } },
    });
    if (existingSkus.length > 0) {
      return res
        .status(400)
        .json({
          message: `SKU đã tồn tại: ${existingSkus
            .map((e) => e.sku)
            .join(", ")}`,
        });
    }

    // ===== Tạo product =====
    const newProduct = await model.products.create({
      name,
      category_id,
      description,
      discount: finalDiscount,
      spec,
      color,
      price,
      status,
      has_size,
    });

    // ===== Tạo product_variants =====
    for (const v of product_variants) {
      await model.product_variants.create({
        product_id: newProduct.product_id,
        color,
        size: has_size ? v.size : null,
        stock: v.stock,
        sku: v.sku,
        price,
      });
    }

    // ===== Lấy lại product full =====
    const productData = await model.products.findOne({
      where: { product_id: newProduct.product_id },
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: [
            "product_variant_id",
            "size",
            "stock",
            "sku",
            "price",
            "color",
          ],
        },
      ],
    });

    const data = {
      ...productData.toJSON(),
      createdAt: formatVNDateTime(productData.createdAt),
      updatedAt: formatVNDateTime(productData.updatedAt),
      category_name: productData.category?.name,
    };
    delete data.category_id;
    delete data.category;

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data,
    });
  } catch (error) {
    console.error("Lỗi createProduct:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const addProductVariant = async (req, res) => {
  try {
    const { id: product_id } = req.params;
    const { color, price, discount, variants } = req.body;

    // ===== KIỂM TRA PRODUCT =====
    const product = await model.products.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ message: "Product không tồn tại" });
    }

    // ===== KIỂM TRA COLOR TRÙNG TRONG SẢN PHẨM =====
    const colorExist = await model.product_variants.findOne({
      where: { product_id, color },
    });
    if (colorExist) {
      return res.status(400).json({
        message: `Màu "${color}" đã tồn tại trong sản phẩm này`,
      });
    }

    // ===== VALIDATE INPUT =====
    if (!color || typeof color !== "string") {
      return res
        .status(400)
        .json({ message: "color bắt buộc và phải là chuỗi" });
    }

    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({ message: "price phải là số >= 0" });
    }

    let finalDiscount = 0;
    if (discount !== undefined && discount !== null) {
      if (typeof discount !== "number") {
        return res.status(400).json({ message: "discount phải là số" });
      }
      if (discount <= 0 || discount >= 100) {
        return res.status(400).json({ message: "discount phải >0 và <100" });
      }
      finalDiscount = discount;
    }

    if (!Array.isArray(variants) || variants.length === 0) {
      return res.status(400).json({ message: "Phải có ít nhất 1 variant" });
    }

    // ===== KIỂM TRA SKU TRÙNG =====
    const skuList = variants.map((v) => v.sku);
    const existingSku = await model.product_variants.findAll({
      where: { sku: skuList },
    });
    if (existingSku.length > 0) {
      return res.status(400).json({
        message: `SKU đã tồn tại: ${existingSku.map((e) => e.sku).join(", ")}`,
      });
    }

    // ===== TẠO VARIANTS MỚI =====
    const createdVariants = [];
    for (const v of variants) {
      const hasSize = v.size ? true : false; // nếu có size -> hasSize = true

      const newVar = await model.product_variants.create({
        product_id,
        color,
        size: hasSize ? v.size : null, // nếu không có size thì để null
        stock: v.stock,
        price,
        discount: finalDiscount,
        sku: v.sku,
        has_size: hasSize, // tự tạo cột để đánh dấu
      });

      createdVariants.push(newVar);
    }

    // ===== TRẢ VỀ =====
    return res.status(201).json({
      message: "Thêm biến thể thành công",
      product: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        discount: product.discount,
        spec: product.spec,
      },
      added_variants: createdVariants,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

const addSizeToVariant = async (req, res) => {
  try {
    const { id: product_id, color } = req.params;
    const { size, stock, sku } = req.body;

    // ====== Kiểm tra input ======
    if (!size || stock === undefined || !sku) {
      return res.status(400).json({
        message: "size, stock, sku là bắt buộc",
      });
    }

    // ====== Chuẩn hóa color ======
    const colorTrimmed = color.replace(/\s+/g, " ").trim();

    // ====== Kiểm tra product tồn tại ======
    const product = await model.products.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ message: "Product không tồn tại" });
    }

    // ====== Kiểm tra màu đã tồn tại ======
    const existingColor = await model.product_variants.findOne({
      where: { product_id, color: colorTrimmed },
    });
    if (!existingColor) {
      return res.status(400).json({
        message: `Màu "${colorTrimmed}" chưa tồn tại trong sản phẩm.`,
      });
    }

    // ====== Kiểm tra size trùng ======
    const sizeExist = await model.product_variants.findOne({
      where: { product_id, color: colorTrimmed, size },
    });
    if (sizeExist) {
      return res.status(400).json({
        message: `Size "${size}" đã tồn tại trong màu "${colorTrimmed}".`,
      });
    }

    // ====== Kiểm tra SKU trùng ======
    const skuExist = await model.product_variants.findOne({ where: { sku } });
    if (skuExist) {
      return res.status(400).json({ message: `SKU "${sku}" đã tồn tại.` });
    }

    // ====== Tạo size mới ======
    const newVariant = await model.product_variants.create({
      product_id,
      color: colorTrimmed,
      size,
      stock,
      price: existingColor.price, // Lấy theo màu hiện có
      discount: existingColor.discount, // Lấy theo màu hiện có
      sku,
    });

    return res.status(201).json({
      message: "Thêm size mới thành công",
      variant: newVariant,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};
const getProductByDanhMucCap1 = async (req, res) => {
  try {
    const root_id = parseInt(req.query.root_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (!root_id) {
      return res.status(400).json({ message: "root_id là bắt buộc" });
    }

    // 1. Kiểm tra danh mục root_id có tồn tại không
    const rootCategory = await model.categories.findByPk(root_id);
    if (!rootCategory) {
      return res.status(404).json({ message: "Danh mục cấp 1 không tồn tại" });
    }

    // 2. Kiểm tra đây là danh mục cấp 1
    if (rootCategory.parent_id !== null) {
      return res
        .status(400)
        .json({ message: "root_id không phải danh mục cấp 1" });
    }

    // 3. Lấy tất cả category con của danh mục cấp 1
    const childCategories = await model.categories.findAll({
      where: { parent_id: root_id },
      attributes: ["category_id"],
      raw: true,
    });

    const childIds = childCategories.map((c) => c.category_id);
    if (childIds.length === 0) {
      return res
        .status(200)
        .json({ message: "Danh mục cấp 1 chưa có sản phẩm", data: [] });
    }

    // 4. Tổng số bản ghi
    const total = await model.products.count({
      where: { category_id: { [Op.in]: childIds } },
    });

    const totalPages = Math.ceil(total / limit);
    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // 5. Lấy sản phẩm + tổng stock
    const products = await model.products.findAll({
      where: { category_id: { [Op.in]: childIds } },
      attributes: [
        "product_id",
        "name",
        "category_id",
        "description",
        "discount",
        "thumbnail",
        "spec",
        [
          literal(
            `(SELECT SUM(stock) FROM product_variants WHERE product_variants.product_id = products.product_id)`
          ),
          "total_stock",
        ],
      ],
      limit,
      offset,
      order: [["name", "ASC"]],
      raw: true,
    });

    return res.status(200).json({
      message: "Lấy danh sách sản phẩm theo danh mục cấp 1 thành công",
      data: products,
      pagination: { total, page: validPage, limit, totalPages },
    });
  } catch (err) {
    console.error("Lỗi getProductByDanhMucCap1:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};
const getAllProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // 1. Tổng số bản ghi
    const total = await model.products.count();

    // 2. Tính totalPages & validPage
    const totalPages = Math.ceil(total / limit);
    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // 3. Lấy danh sách sản phẩm phân trang, include category
    const products = await model.products.findAll({
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: [
        "product_id",
        "name",
        "category_id",
        "description",
        "discount",
        "thumbnail",
        "status",
      ],
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name", "parent_id"],
        },
      ],
      raw: true, // trả về plain object
    });

    return res.status(200).json({
      message: "Lấy danh sách tất cả sản phẩm thành công",
      data: products,
      pagination: {
        total,
        page: validPage,
        limit,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Lỗi getAllProducts:", err);
    return res.status(500).json({
      message: "Lỗi server",
      error: err.message,
    });
  }
};


const getProductVariants = async (req, res) => {
  try {
    const product_id = parseInt(req.params.id);

    const product = await model.products.findOne({
      where: { product_id },
      include: [
        {
          model: model.product_variants,
          as: "product_variants", // phải đúng alias
          attributes: [
            "product_variant_id",
            "size",
            "stock",
            "sku",
            "price",
            "color",
          ],
        },
        {
          model: model.categories,
          as: "category", // alias đúng
          attributes: ["category_id", "name", "parent_id"],
        },
      ],
    });

    if (!product) {
      return res.status(404).json({ message: "Product không tồn tại" });
    }

    return res.status(200).json({
      message: "Lấy biến thể sản phẩm thành công",
      data: product,
    });
  } catch (error) {
    console.error("Lỗi getProductVariants:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const updateProduct = async (req, res) => {
  try {
    const product_id = parseInt(req.params.id);
    const { name, category_id, description, price, discount, spec, color } =
      req.body;

    // Kiểm tra product tồn tại
    const product = await model.products.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ message: "Product không tồn tại" });
    }

    // Kiểm tra category nếu có cập nhật
    if (category_id) {
      const category = await model.categories.findByPk(category_id);
      if (!category) {
        return res.status(400).json({ message: "Category không tồn tại" });
      }
    }

    // Kiểm tra price và discount nếu có
    if (price !== undefined && (typeof price !== "number" || price < 0)) {
      return res.status(400).json({ message: "Price phải là số >= 0" });
    }
    if (discount !== undefined) {
      if (typeof discount !== "number" || discount < 0 || discount >= 100) {
        return res.status(400).json({ message: "Discount phải >0 và <100" });
      }
    }

    // Cập nhật product
    await product.update({
      name: name ?? product.name,
      category_id: category_id ?? product.category_id,
      description: description ?? product.description,
      price: price ?? product.price,
      discount: discount ?? product.discount,
      spec: spec ?? product.spec,
      color: color ?? product.color,
    });

    // Lấy lại product full với category
    const updatedProduct = await model.products.findOne({
      where: { product_id },
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name", "parent_id"],
        },
      ],
    });

    return res.status(200).json({
      message: "Cập nhật sản phẩm thành công",
      data: updatedProduct,
    });
  } catch (error) {
    console.error("Lỗi updateProduct:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const updateProductVariant = async (req, res) => {
  try {
    const { id: product_variant_id } = req.params; // id biến thể
    const { product_id, color, size, stock, price, discount, sku } = req.body;

    // 1. Kiểm tra biến thể tồn tại
    const variant = await model.product_variants.findByPk(product_variant_id);
    if (!variant) {
      return res.status(404).json({ message: "Variant không tồn tại" });
    }

    // 2. Kiểm tra biến thể có thuộc sản phẩm đúng không
    if (product_id && variant.product_id !== product_id) {
      return res.status(400).json({
        message: "Variant này không thuộc sản phẩm được cung cấp",
      });
    }

    // 3. Validate các trường nếu có gửi
    if (stock !== undefined && (typeof stock !== "number" || stock < 0)) {
      return res.status(400).json({ message: "Stock phải là số >= 0" });
    }

    if (price !== undefined && (typeof price !== "number" || price < 0)) {
      return res.status(400).json({ message: "Price phải là số >= 0" });
    }

    if (
      discount !== undefined &&
      (typeof discount !== "number" || discount < 0 || discount >= 100)
    ) {
      return res.status(400).json({ message: "Discount phải >0 và <100" });
    }

    // 4. Kiểm tra SKU trùng (trong cùng sản phẩm)
    if (sku && sku !== variant.sku) {
      const existingSku = await model.product_variants.findOne({
        where: {
          sku,
          product_id: variant.product_id,
          product_variant_id: { [Op.ne]: variant.product_variant_id },
        },
      });

      if (existingSku) {
        return res.status(400).json({ message: `SKU "${sku}" đã tồn tại` });
      }
    }

    // 5. Cập nhật biến thể
    await variant.update({
      color: color ?? variant.color,
      size: size ?? variant.size,
      stock: stock ?? variant.stock,
      price: price ?? variant.price,
      discount: discount ?? variant.discount,
      sku: sku ?? variant.sku,
    });

    return res.status(200).json({
      message: "Cập nhật biến thể thành công",
      data: variant,
    });
  } catch (error) {
    console.error("Lỗi updateProductVariant:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

// Ẩn sản phẩm theo product_id
const hideProduct = async (req, res) => {
  try {
    const { id } = req.params; // product_id từ URL
    if (!id) {
      return res.status(400).json({ message: "Chưa cung cấp product_id" });
    }

    // Tìm sản phẩm
    const product = await model.products.findByPk(id);
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Cập nhật status sang inactive/hidden
    product.status = "inactive"; // hoặc "hidden" nếu muốn
    await product.save();

    return res.status(200).json({
      message: "Sản phẩm đã được ẩn thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        status: product.status,
      },
    });
  } catch (error) {
    console.error("Lỗi hideProduct:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const getActiveProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // 1. Tổng số bản ghi active
    const total = await model.products.count({ where: { status: "active" } });

    // 2. Tính totalPages & validPage
    const totalPages = Math.ceil(total / limit);
    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // 3. Lấy danh sách sản phẩm active phân trang
    const products = await model.products.findAll({
      where: { status: "active" },
      attributes: [
        "product_id",
        "name",
        "category_id",
        "description",
        "discount",
        "thumbnail",
        "status",
      ],
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name", "parent_id"],
        },
      ],
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      raw: true,
    });

    return res.status(200).json({
      message: "Lấy danh sách sản phẩm active thành công",
      data: products,
      pagination: { total, page: validPage, limit, totalPages },
    });
  } catch (err) {
    console.error("Lỗi getActiveProducts:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

const unhideProduct = async (req, res) => {
  try {
    const { id } = req.params; // product_id từ URL
    if (!id) {
      return res.status(400).json({ message: "Chưa cung cấp product_id" });
    }

    // Tìm sản phẩm
    const product = await model.products.findByPk(id);
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Cập nhật status sang active
    product.status = "active";
    await product.save();

    return res.status(200).json({
      message: "Sản phẩm đã được hiển thị lại thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        status: product.status,
      },
    });
  } catch (error) {
    console.error("Lỗi unhideProduct:", error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};

const getProductByKeyWordAdmin = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    // 1. Tính tổng số bản ghi thỏa mãn keyword (sản phẩm hoặc variant)
    const total = await model.products.count({
      include: [
        {
          model: model.product_variants,
          as: "product_variants",
          required: false,
          where: {
            [Op.or]: [
              { sku: { [Op.iLike]: `%${keyword}%` } },
              { color: { [Op.iLike]: `%${keyword}%` } },
            ],
          },
        },
      ],
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${keyword}%` } },
          literal(`spec::text ILIKE '%${keyword}%'`), // tìm trong JSONB spec
        ],
      },
      distinct: true,
    });

    if (total === 0) {
      return res.status(200).json({
        message: "Không có sản phẩm phù hợp",
        data: [],
        pagination: { total: 0, page: 1, limit: pageSize, totalPages: 0 },
      });
    }

    // 2. Tính totalPages & validPage
    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    // 3. Lấy danh sách sản phẩm phân trang
    const products = await model.products.findAll({
      include: [
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: ["product_variant_id", "sku", "color", "size", "stock", "price"],
          where: {
            [Op.or]: [
              { sku: { [Op.iLike]: `%${keyword}%` } },
              { color: { [Op.iLike]: `%${keyword}%` } },
            ],
          },
          required: false,
        },
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name"],
        },
      ],
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: `%${keyword}%` } },
          literal(`spec::text ILIKE '%${keyword}%'`),
        ],
      },
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
    });

    return res.status(200).json({
      message: `Tìm sản phẩm theo keyword '${keyword}' thành công`,
      data: products,
      pagination: {
        total,
        page: validPage,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Lỗi searchProductsWithVariants:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};
const getProductByKeyWordUser = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    // 1. Đếm tổng số bản ghi thỏa mãn
    const total = await model.products.count({
      where: { status: "active" },
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: [],
        },
      ],
      distinct: true,
      // Tìm theo tên sản phẩm hoặc tên category
      where: {
        status: "active",
        [Op.or]: [
          { name: { [Op.iLike]: `%${keyword}%` } },
          { "$category.name$": { [Op.iLike]: `%${keyword}%` } },
        ],
      },
    });

    if (total === 0) {
      return res.status(200).json({
        message: "Không có sản phẩm phù hợp",
        data: [],
        pagination: { total: 0, page: 1, limit: pageSize, totalPages: 0 },
      });
    }

    // 2. Tính totalPages & validPage
    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    // 3. Lấy danh sách sản phẩm phân trang
    const products = await model.products.findAll({
      where: {
        status: "active",
        [Op.or]: [
          { name: { [Op.iLike]: `%${keyword}%` } },
          { "$category.name$": { [Op.iLike]: `%${keyword}%` } },
        ],
      },
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name"],
        },
      ],
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
    });

    return res.status(200).json({
      message: `Tìm sản phẩm active theo keyword '${keyword}' thành công`,
      data: products,
      pagination: {
        total,
        page: validPage,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Lỗi searchActiveProductsByNameOrCategory:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};
const addThumbnailProduct = async (req, res) => {
  try {
    const { product_id } = req.body;
    if (!product_id) return res.status(400).json({ message: "product_id là bắt buộc" });
    if (!req.file) return res.status(400).json({ message: "Vui lòng upload 1 ảnh" });

    const product = await model.products.findByPk(product_id);
    if (!product) return res.status(404).json({ message: "Sản phẩm không tồn tại" });

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "products",
      resource_type: "image",
    });
    await fs.unlink(req.file.path);

    product.thumbnail = result.secure_url;
    await product.save();

    return res.status(200).json({
      message: "Thêm thumbnail sản phẩm thành công",
      data: { product_id: product.product_id, thumbnail: product.thumbnail },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};

const addImageVariant = async (req, res) => {
  try {
    const { variant_id } = req.body;
    if (!variant_id) return res.status(400).json({ message: "variant_id là bắt buộc" });
    if (!req.files || req.files.length === 0) return res.status(400).json({ message: "Vui lòng upload ít nhất 1 ảnh" });

    const variant = await model.product_variants.findByPk(variant_id);
    if (!variant) return res.status(404).json({ message: "Variant không tồn tại" });

    const uploadedUrls = [];
    for (const file of req.files) {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: `variants/${variant_id}`,
        resource_type: "image",
      });
      uploadedUrls.push(result.secure_url);
      await fs.unlink(file.path);
    }

    const images = [];
    for (const url of uploadedUrls) {
      const img = await model.product_images.create({
        product_variant_id: variant_id,
        image: url,
      });
      images.push(img);
    }

    return res.status(200).json({
      message: "Thêm ảnh cho biến thể thành công",
      data: images,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};
export {
  addProduct,
  addProductVariant,
  addSizeToVariant,
  getProductByDanhMucCap1,
  getAllProducts,
  getProductVariants,
  updateProduct,
  updateProductVariant,
  hideProduct,
  unhideProduct,
  getActiveProducts,
  getProductByKeyWordAdmin,
  getProductByKeyWordUser,
  addThumbnailProduct,
  addImageVariant,
};
