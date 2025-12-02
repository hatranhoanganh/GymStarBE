import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, literal } from "sequelize";
import cloudinary from "../config/cloudinary.js";
import fs from "fs/promises";

dotenv.config();
const model = initModels(sequelize);

// Loại bỏ dấu tiếng Việt
const removeVietnameseTones = (str = "") => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

// Tạo code category
const buildCategoryCode = (name = "") => {
  return removeVietnameseTones(name)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();
};

// Tạo code color
const getColorCode = (color = "") => {
  return removeVietnameseTones(color)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
};

// Tạo SKU
const buildSKU = (categoryName, productId, color, size) => {
  const categoryCode = buildCategoryCode(categoryName);
  const colorCode = getColorCode(color);
  let sku = `${categoryCode}${productId}-${colorCode}`;
  if (size) sku += `-${size}`;
  return sku;
};

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

    // Kiểm tra variants
    if (!Array.isArray(product_variants) || product_variants.length === 0) {
      return res.status(400).json({ message: "Phải có ít nhất 1 variant" });
    }

    for (const v of product_variants) {
      if (v.stock === undefined) {
        return res.status(400).json({ message: "Variant phải có stock" });
      }
    }

    // ===== Tạo product =====
    const newProduct = await model.products.create({
      name,
      category_id,
      description,
      thumbnail: null,
      discount: finalDiscount,
      spec,
      color,
      price,
      status,
    });

    // ===== Tạo variant + SKU =====
    const createdVariants = [];
    for (const v of product_variants) {
      const autoSKU = buildSKU(
        category.name,
        newProduct.product_id,
        color,
        v.size
      );

      const newVar = await model.product_variants.create({
        product_id: newProduct.product_id,
        color,
        size: v.size || null,
        stock: v.stock,
        price,
        discount: finalDiscount,
        sku: autoSKU,
      });

      createdVariants.push(newVar);
    }

    // ===== Format trả về giống addProductVariant =====
    const formattedVariants = createdVariants.map((v) => ({
      product_variant_id: v.product_variant_id,
      size: v.size,
      stock: v.stock,
      color: v.color,
      sku: v.sku,
      price: v.price,
      discount: v.discount,
    }));

    const formatData = {
      product_id: newProduct.product_id,
      name: newProduct.name,
      description: newProduct.description,
      thumbnail: newProduct.thumbnail,
      discount: newProduct.discount,
      spec: newProduct.spec,
      color: newProduct.color,
      price: newProduct.price,
      status: newProduct.status,
      category_id,
      category_name: category.name,
      createdAt: formatVNDateTime(newProduct.createdAt),
      updatedAt: formatVNDateTime(newProduct.updatedAt),
      product_variants: formattedVariants,
    };

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data: formatData,
    });
  } catch (error) {
    console.error("Lỗi createProduct:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const addFullProduct = async (req, res) => {
  try {
    const { name, category_id, description = "", price, discount, spec } = req.body;
    const cleanName = name?.trim();

    // Validate tên sản phẩm
    if (!cleanName) {
      req.files?.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Tên sản phẩm không hợp lệ" });
    }

    // Parse product_variants
    let product_variants = [];
    if (req.body.product_variants) {
      try {
        product_variants = JSON.parse(req.body.product_variants);
      } catch {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "product_variants phải là JSON hợp lệ" });
      }
    }

    // Kiểm tra dữ liệu bắt buộc
    if (!cleanName || !category_id || price === undefined || !Array.isArray(product_variants) || product_variants.length === 0) {
      req.files?.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Thiếu dữ liệu sản phẩm" });
    }

    // Kiểm tra category tồn tại
    const category = await model.categories.findByPk(category_id);
    if (!category) {
      req.files?.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Category không tồn tại" });
    }

    // Kiểm tra tên sản phẩm trùng
    const existingProduct = await model.products.findOne({ where: { name: cleanName, category_id } });
    if (existingProduct) {
      req.files?.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Sản phẩm với tên này đã tồn tại trong danh mục" });
    }

    // Kiểm tra price & discount
    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 40000 || numPrice > 10000000) {
      req.files?.forEach((f) => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Price phải >= 40000 và <= 10000000" });
    }

    let finalDiscount = 0;
    if (discount !== undefined && discount !== null) {
      const numDiscount = Number(discount);
      if (isNaN(numDiscount) || numDiscount < 0 || numDiscount >= 100) {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "Discount phải >=0 và <100" });
      }
      finalDiscount = numDiscount;
    }

    // Validate variants
    const cleanVariants = [];
    for (const v of product_variants) {
      const cleanColor = v.color?.trim();
      const cleanSize = v.size?.trim() || null; // có thể null

      if (!cleanColor) {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "Color không được để trống" });
      }

      if (v.stock === undefined) {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "Stock không được để trống" });
      }

      if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(cleanColor)) {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Màu phải là chữ cái, không chứa số: ${cleanColor}` });
      }

      if (v.stock <= 0) {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Stock của variant màu ${cleanColor} size ${cleanSize} phải > 0` });
      }

      // Kiểm tra trùng variant
      const exists = cleanVariants.find(cv => cv.color === cleanColor && cv.size === cleanSize);
      if (exists) {
        req.files?.forEach((f) => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Variant màu ${cleanColor} size ${cleanSize} đã tồn tại` });
      }

      cleanVariants.push({ ...v, cleanColor, cleanSize });
    }

    // ===== Tạo product =====
    const newProduct = await model.products.create({
      name: cleanName,
      category_id,
      description,
      thumbnail: null,
      discount: finalDiscount,
      spec,
      price: numPrice,
      status: "đang bán",
    });

    // ===== Upload thumbnail =====
    const thumbnailFile = req.files.find(f => f.fieldname === "thumbnail");
    if (thumbnailFile) {
      try {
        const result = await cloudinary.uploader.upload(thumbnailFile.path, {
          folder: `products/${newProduct.product_id}/thumbnail`,
          resource_type: "image",
        });
        newProduct.thumbnail = result.secure_url;
        await newProduct.save();
        await fs.unlink(thumbnailFile.path);
      } catch (err) {
        console.warn("Lỗi upload thumbnail:", err.message);
      }
    }

    // ===== Tạo product variants + upload images =====
    const createdVariants = [];
    const variantFiles = req.files.filter(f => f.fieldname !== "thumbnail");
    const imagesByColor = {};

    for (const v of cleanVariants) {
      const sku = buildSKU(category.name, newProduct.product_id, v.cleanColor, v.cleanSize);
      const newVar = await model.product_variants.create({
        product_id: newProduct.product_id,
        color: v.cleanColor,
        size: v.cleanSize,
        stock: v.stock,
        sku,
      });
      createdVariants.push(newVar);
    }

    // Upload images theo màu
    const colorSet = [...new Set(createdVariants.map(v => v.color))];
    colorSet.forEach(color => (imagesByColor[color] = []));
    let fileIndex = 0;
    for (const color of colorSet) {
      const filesForColor = variantFiles.slice(fileIndex, fileIndex + createdVariants.filter(v => v.color === color).length);
      for (const file of filesForColor) {
        try {
          const folderName = color.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
          const result = await cloudinary.uploader.upload(file.path, {
            folder: `products/${newProduct.product_id}/${folderName}`,
            resource_type: "image",
          });
          imagesByColor[color].push(result.secure_url);
          await model.product_images.create({
            product_id: newProduct.product_id,
            color,
            image: result.secure_url,
          });
          await fs.unlink(file.path);
        } catch (err) {
          console.warn("Lỗi upload ảnh biến thể:", err.message);
        }
      }
      fileIndex += createdVariants.filter(v => v.color === color).length;
    }

    // ===== Format response =====
    const formattedVariants = createdVariants.map(v => ({
      product_variant_id: v.product_variant_id,
      size: v.size,
      stock: v.stock,
      color: v.color,
      sku: v.sku,
    }));

    const colorsGrouped = colorSet.map(color => ({
      color,
      images: imagesByColor[color] || [],
    }));

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data: {
        product_id: newProduct.product_id,
        name: newProduct.name,
        description: newProduct.description,
        thumbnail: newProduct.thumbnail,
        discount: newProduct.discount,
        spec: newProduct.spec,
        price: newProduct.price,
        status: newProduct.status,
        category_id,
        category_name: category.name,
        createdAt: formatVNDateTime(newProduct.createdAt),
        updatedAt: formatVNDateTime(newProduct.updatedAt),
        product_variants: formattedVariants,
        colors: colorsGrouped,
      },
    });
  } catch (error) {
    req.files?.forEach(f => fs.unlink(f.path, () => {}));
    console.error(error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};
const addProductVariant = async (req, res) => {
  try {
    const { product_id } = req.params;

    if (!product_id) {
      req.files?.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Thiếu product_id trong URL" });
    }

    // Parse variants
    let variants = [];
    try {
      variants = JSON.parse(req.body.variants);
    } catch {
      req.files?.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Trường variants phải là JSON hợp lệ" });
    }

    if (!Array.isArray(variants) || variants.length === 0) {
      req.files?.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(400).json({ message: "Danh sách variants trống" });
    }

    // Lấy product + category
    const product = await model.products.findByPk(product_id, {
      include: [{ model: model.categories, as: "category", attributes: ["name"] }],
    });
    if (!product) {
      req.files?.forEach(f => fs.unlink(f.path, () => {}));
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // ===== VALIDATE variants =====
    const cleanVariants = [];
    for (const v of variants) {
      const cleanColor = v.color?.trim();
      const cleanSize = v.size?.trim() || null;
      const stock = v.stock;

      if (!cleanColor) {
        req.files?.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: "Color không được để trống" });
      }
      if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(cleanColor)) {
        req.files?.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Màu phải là chữ cái, không chứa số: ${cleanColor}` });
      }
      if (stock == null || !Number.isInteger(stock) || stock <= 0) {
        req.files?.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Stock của variant màu ${cleanColor} size ${cleanSize} phải là số nguyên > 0` });
      }

      // Kiểm tra trùng trong DB
      const exist = await model.product_variants.findOne({
        where: { product_id, color: cleanColor, size: cleanSize },
      });
      if (exist) {
        req.files?.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Variant màu ${cleanColor} size ${cleanSize} đã tồn tại` });
      }

      // Kiểm tra trùng trong request
      if (cleanVariants.find(cv => cv.cleanColor === cleanColor && cv.cleanSize === cleanSize)) {
        req.files?.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({ message: `Variant màu ${cleanColor} size ${cleanSize} đã tồn tại trong request` });
      }

      cleanVariants.push({ ...v, cleanColor, cleanSize });
    }

    // ===== Tạo product variants =====
    const createdVariants = [];
    for (const v of cleanVariants) {
      const sku = buildSKU(product.category.name, product_id, v.cleanColor, v.cleanSize);
      const newVar = await model.product_variants.create({
        product_id,
        color: v.cleanColor,
        size: v.cleanSize,
        stock: v.stock,
        sku,
      });
      createdVariants.push(newVar);
    }

    // ===== Gom và upload ảnh variant =====
    // ===== Tạo product variants + upload images =====
const variantFiles = req.files?.filter(f => f.fieldname !== "thumbnail") || [];
const imagesByColor = {};


// Upload images theo màu
const colorSet = [...new Set(createdVariants.map(v => v.color))];
colorSet.forEach(color => (imagesByColor[color] = []));
let fileIndex = 0;

for (const color of colorSet) {
  const filesForColor = variantFiles.slice(fileIndex, fileIndex + createdVariants.filter(v => v.color === color).length);

  for (const file of filesForColor) {
    try {
      const folderName = color.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
      const result = await cloudinary.uploader.upload(file.path, {
        folder: `products/${product_id}/${folderName}`,
        resource_type: "image",
      });

      imagesByColor[color].push(result.secure_url);

      // Lưu vào DB, chỉ cần product_id + color + image
      await model.product_images.create({
        product_id,
        color,
        image: result.secure_url,
      });

      await fs.unlink(file.path);
    } catch (err) {
      console.warn("Upload ảnh lỗi:", err.message);
    }
  }

  fileIndex += createdVariants.filter(v => v.color === color).length;
}


    // ===== Format response =====
    const colorsGrouped = colorSet.map(color => ({
      color,
      images: imagesByColor[color] || [],
    }));

    const formattedVariants = createdVariants.map(v => ({
      product_variant_id: v.product_variant_id,
      size: v.size,
      stock: v.stock,
      color: v.color,
      sku: v.sku,
    }));

    return res.status(201).json({
      message: "Thêm variants thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        thumbnail: product.thumbnail,
        discount: product.discount,
        spec: product.spec,
        price: product.price,
        status: product.status,
        category_id: product.category_id,
        category_name: product.category.name,
        product_variants: formattedVariants,
        colors: colorsGrouped,
      },
    });
  } catch (err) {
    req.files?.forEach(f => fs.unlink(f.path, () => {}));
    console.error(err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};




const addSizeToVariant = async (req, res) => {
  try {
    const { product_id, color } = req.params;
    const { size, stock } = req.body;

    // ====== Validate input ======

    if (stock === undefined || typeof stock !== "number" || stock <= 0) {
      return res.status(400).json({ message: "Stock phải là số > 0" });
    }

    const colorTrimmed = color.replace(/\s+/g, " ").trim();

    // ====== Kiểm tra product tồn tại ======
    const product = await model.products.findByPk(product_id, {
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
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

    // ====== Tạo SKU tự động ======
    const sku = buildSKU(
      product.category.name,
      product.product_id,
      colorTrimmed,
      size
    );

    // ====== Tạo size mới ======
    const newVariant = await model.product_variants.create({
      product_id,
      color: colorTrimmed,
      size,
      stock,
      price: existingColor.price,
      discount: existingColor.discount,
      sku,
    });

    // ====== Format giống addProductVariant ======
    const formattedVariant = {
      product_variant_id: newVariant.product_variant_id,
      size: newVariant.size,
      stock: newVariant.stock,
      color: newVariant.color,
      sku: newVariant.sku,
      price: newVariant.price,
      discount: newVariant.discount,
    };

    return res.status(201).json({
      message: "Thêm size mới thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        thumbnail: product.thumbnail,
        discount: product.discount,
        spec: product.spec,
        color: colorTrimmed,
        price: existingColor.price,
        category_name: product.category?.name || null,
        new_variants: [formattedVariant],
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

const getAllChildCategoryIds = (categories, parentId) => {
  let result = [];

  const directChildren = categories.filter((c) => c.parent_id === parentId);

  directChildren.forEach((child) => {
    result.push(child.category_id);

    // tiếp tục lấy cấp sâu hơn
    result = result.concat(
      getAllChildCategoryIds(categories, child.category_id)
    );
  });

  return result;
};

const getProductByDanhMucCap1 = async (req, res) => {
  try {
    const root_id = parseInt(req.params.root_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (!root_id) {
      return res.status(400).json({ message: "root_id là bắt buộc" });
    }

    // 1. Kiểm tra danh mục cấp 1
    const rootCategory = await model.categories.findByPk(root_id, {
      include: [{ model: model.categories, as: "parent" }],
    });
    if (!rootCategory)
      return res.status(404).json({ message: "Danh mục cấp 1 không tồn tại" });

    if (rootCategory.parent_id !== null)
      return res
        .status(400)
        .json({ message: "root_id không phải danh mục cấp 1" });

    // 2. Lấy toàn bộ categories
    const allCategories = await model.categories.findAll({
      attributes: ["category_id", "parent_id"],
      raw: true,
    });

    // 3. Lấy toàn bộ ID danh mục con mọi cấp
    const childIds = getAllChildCategoryIds(allCategories, root_id);
    childIds.push(root_id); // Thêm root_id nếu có sản phẩm

    // 4. Đếm tổng sản phẩm
    const total = await model.products.count({
      where: { category_id: { [Op.in]: childIds } },
    });

    const totalPages = Math.ceil(total / limit);
    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // 5. Lấy danh sách sản phẩm
    const rows = await model.products.findAll({
      where: { category_id: { [Op.in]: childIds } },
      limit,
      offset,
      order: [["name", "ASC"]],
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "spec",
        "thumbnail",
        "status",
        "category_id",
        ["created_at", "createdAt"],
        ["updated_at", "updatedAt"],
      ],
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["name", "parent_id"],
          include: [
            {
              model: model.categories,
              as: "parent",
              attributes: ["name"],
            },
          ],
        },
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: [
            "product_variant_id",
            "color",
            "size",
            "stock",
            "price",
            "sku",
          ],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
      ],
      nest: true,
    });

    // 6. Format dữ liệu giống getAllProducts
    const formatted = rows.map((p) => {
      // Gom ảnh theo màu
      const colorMap = {};
      p.product_images.forEach((img) => {
        if (!colorMap[img.color]) {
          colorMap[img.color] = { color: img.color, images: [] };
        }
        colorMap[img.color].images.push(img.image);
      });

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        spec: p.spec || null,
        thumbnail: p.thumbnail,
        status: p.status,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        parent_category_name: p.category?.parent?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
        variants: p.product_variants || [],
        colors: Object.values(colorMap),
      };
    });

    return res.status(200).json({
      message: "Lấy sản phẩm từ danh mục cấp 1 thành công",
      total,
      page: validPage,
      totalPages,
      data: formatted,
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

    // Tổng số sản phẩm
    const total = await model.products.count();
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      return res.status(200).json({
        message: "Không có dữ liệu sản phẩm.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // Lấy danh sách sản phẩm
    const rows = await model.products.findAll({
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "spec",
        "thumbnail",
        "status",
        "category_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["name", "parent_id"],
          include: [
            {
              model: model.categories,
              as: "parent",
              attributes: ["name"],
            },
          ],
        },
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: [
            "product_variant_id",
            "color",
            "size",
            "stock",
            "price",
            "sku",
          ],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
      ],
      nest: true,
    });

    // =============================
    // FORMAT DỮ LIỆU
    // =============================
    const formatted = rows.map((p) => {
      // Gom ảnh theo màu
      const colorMap = {};
      p.product_images.forEach((img) => {
        if (!colorMap[img.color]) {
          colorMap[img.color] = {
            color: img.color,
            images: [],
          };
        }
        colorMap[img.color].images.push(img.image);
      });

      // Format variants
      const formattedVariants = p.product_variants.map((v) => ({
        product_variant_id: v.product_variant_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        price: v.price,
        sku: v.sku,
      }));

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        spec: p.spec || null,
        thumbnail: p.thumbnail,
        status: p.status,

        category_id: p.category_id,
        category_name: p.category?.name || null,
        parent_category_name: p.category?.parent?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),

        product_variants: formattedVariants,
        colors: Object.values(colorMap),
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách tất cả sản phẩm thành công",
      total,
      page: validPage,
      totalPages,
      data: formatted,
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
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "status",
        "thumbnail",
        "spec",
        "createdAt",
        "updatedAt",
        "category_id",
      ],
      include: [
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
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name", "parent_id"],
          include: [
            {
              model: model.categories,
              as: "parent",
              attributes: ["name"],
            },
          ],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
      ],
    });

    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Gom ảnh theo màu
    const colors = [];
    const colorMap = {};
    product.product_images.forEach((img) => {
      if (!colorMap[img.color]) {
        colorMap[img.color] = { color: img.color, images: [] };
        colors.push(colorMap[img.color]);
      }
      colorMap[img.color].images.push(img.image);
    });

    // Format ngày
    const createdAt = formatVNDateTime(product.createdAt);
    const updatedAt = formatVNDateTime(product.updatedAt);

    // Lấy thông tin category + parent
    const categoryInfo = product.category
      ? {
          category_id: product.category.category_id,
          category_name: product.category.name,
          parent_id: product.category.parent_id,
          parent_category_name: product.category.parent
            ? product.category.parent.name
            : null,
        }
      : null;

    // Trả dữ liệu chuẩn
    return res.status(200).json({
      message: "Lấy biến thể sản phẩm thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        discount: product.discount,
        status: product.status,
        thumbnail: product.thumbnail,
        spec: product.spec,
        createdAt,
        updatedAt,
        ...categoryInfo,
        colors,
        product_variants: product.product_variants,
      },
    });
  } catch (error) {
    console.error("Lỗi getProductVariants:", error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
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
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Kiểm tra category nếu có cập nhật
    if (category_id) {
      const category = await model.categories.findByPk(category_id);
      if (!category) {
        return res.status(400).json({ message: "Danh mục không tồn tại" });
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

const getActiveProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // 1. Tổng số sản phẩm active
    const total = await model.products.count({ where: { status: "active" } });

    if (total === 0) {
      return res.status(200).json({
        message: "Không có dữ liệu sản phẩm active.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const totalPages = Math.ceil(total / limit);
    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // 2. Lấy danh sách sản phẩm active
    const rows = await model.products.findAll({
      where: { status: "active" },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "spec",
        "thumbnail",
        "status",
        "category_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["name", "parent_id"],
          include: [
            {
              model: model.categories,
              as: "parent",
              attributes: ["name"],
            },
          ],
        },
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: [
            "product_variant_id",
            "color",
            "size",
            "stock",
            "price",
            "sku",
          ],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
      ],
      nest: true,
    });

    // 3. Format dữ liệu
    const formatted = rows.map((p) => {
      // Gom ảnh theo màu
      const colorMap = {};
      p.product_images.forEach((img) => {
        if (!colorMap[img.color]) {
          colorMap[img.color] = { color: img.color, images: [] };
        }
        colorMap[img.color].images.push(img.image);
      });

      // Format variants
      const formattedVariants = p.product_variants.map((v) => ({
        product_variant_id: v.product_variant_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        price: v.price,
        sku: v.sku,
      }));

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        spec: p.spec || null,
        thumbnail: p.thumbnail,
        status: p.status,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        parent_category_name: p.category?.parent?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
        product_variants: formattedVariants,
        colors: Object.values(colorMap),
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách sản phẩm active thành công",
      total,
      page: validPage,
      totalPages,
      data: formatted,
    });
  } catch (err) {
    console.error("Lỗi getActiveProducts:", err);
    return res.status(500).json({
      message: "Lỗi server",
      error: err.message,
    });
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
          attributes: [
            "product_variant_id",
            "sku",
            "color",
            "size",
            "stock",
            "price",
          ],
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
    const { product_id } = req.params; // lấy từ URL

    if (!product_id)
      return res.status(400).json({ message: "product_id là bắt buộc" });

    if (!req.file)
      return res.status(400).json({ message: "Vui lòng upload 1 ảnh" });

    // Tìm sản phẩm
    const product = await model.products.findByPk(product_id);
    if (!product)
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });

    // Upload Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: `products/${product_id}/thumbnail`,
      resource_type: "image",
    });

    // Xóa file tạm
    await fs.unlink(req.file.path);

    // Cập nhật thumbnail
    product.thumbnail = result.secure_url;
    await product.save();

    // Lấy lại product + category
    const fullProduct = await model.products.findOne({
      where: { product_id },
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["name"],
        },
      ],
    });

    if (!fullProduct)
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });

    const p = fullProduct.get({ plain: true });

    const responseData = {
      product_id: p.product_id,
      name: p.name,
      description: p.description,
      discount: p.discount,
      status: p.status,
      thumbnail: p.thumbnail,
      spec: p.spec,
      createdAt: formatVNDateTime(p.createdAt),
      updatedAt: formatVNDateTime(p.updatedAt),
      category_id: p.category_id,
      category_name: p.category?.name || null,
    };

    return res.status(200).json({
      message: "Thêm thumbnail sản phẩm thành công",
      data: responseData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};

const addImageProductByColor = async (req, res) => {
  try {
    const { color } = req.body;
    const files = req.files;
    const { product_id } = req.params; // lấy từ URL

    if (!product_id || !color) {
      return res.status(400).json({ message: "Thiếu product_id hoặc color" });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Vui lòng upload ít nhất 1 ảnh" });
    }

    if (files.length > 10) {
      return res
        .status(400)
        .json({ message: "Chỉ được upload tối đa 10 ảnh mỗi lần" });
    }

    // Kiểm tra product tồn tại
    const product = await model.products.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Kiểm tra color tồn tại trong product_variants
    const existingVariants = await model.product_variants.findAll({
      where: { product_id },
      attributes: ["color"],
      raw: true,
    });

    const variantColors = existingVariants.map((v) => v.color);
    if (!variantColors.includes(color)) {
      return res.status(400).json({
        message: `Màu "${color}" không tồn tại trong sản phẩm này`,
      });
    }

    const uploadedImages = [];

    for (const file of files) {
      let result;
      if (file.path) {
        result = await cloudinary.uploader.upload(file.path, {
          folder: `products/${product_id}/${color}`,
        });

        try {
          await fs.unlink(file.path);
        } catch (err) {
          console.warn(err.message);
        }
      } else if (file.buffer) {
        result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: `products/${product_id}/${color}` },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(file.buffer);
        });
      }

      await model.product_images.create({
        product_id,
        color,
        image: result.secure_url,
      });

      uploadedImages.push(result.secure_url);
    }

    // Lấy tất cả ảnh product, group theo màu
    const allImages = await model.product_images.findAll({
      where: { product_id },
      attributes: ["color", "image"],
      raw: true,
    });

    const colorsGrouped = Object.values(
      allImages.reduce((acc, cur) => {
        if (!acc[cur.color]) acc[cur.color] = { color: cur.color, images: [] };
        acc[cur.color].images.push(cur.image);
        return acc;
      }, {})
    );

    // Lấy product + category
    const fullProduct = await model.products.findOne({
      where: { product_id },
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });

    const p = fullProduct.get({ plain: true });

    const productData = {
      product_id: p.product_id,
      category_id: p.category_id,
      category_name: p.category?.name || null,
      name: p.name,
      description: p.description,
      discount: p.discount,
      status: p.status,
      thumbnail: p.thumbnail,
      spec: p.spec,
      createdAt: formatVNDateTime(p.createdAt),
      updatedAt: formatVNDateTime(p.updatedAt),
      colors: colorsGrouped,
    };

    return res.status(200).json({
      message: "Thêm ảnh biến thể thành công",
      data: productData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
  }
};

// Lấy chi tiết sản phẩm kèm biến thể và ảnh theo màu
const getProductDetailAdmin = async (req, res) => {
  try {
    const { product_id } = req.params;

    // Lấy thông tin sản phẩm + category name
    const product = await model.products.findByPk(product_id, {
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "status",
        "thumbnail",
        "spec",
        "category_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
          order: [["createdAt", "ASC"]],
        },
        {
          model: model.categories,
          as: "category",
          attributes: ["name"], // <-- Lấy tên danh mục
        },
      ],
    });

    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Gom ảnh theo màu
    const colors = [];
    const colorMap = {};

    product.product_images.forEach((img) => {
      if (!colorMap[img.color]) {
        colorMap[img.color] = {
          color: img.color,
          images: [],
        };
        colors.push(colorMap[img.color]);
      }
      colorMap[img.color].images.push(img.image);
    });

    return res.status(200).json({
      message: "Lấy thông tin sản phẩm thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        discount: product.discount,
        status: product.status,
        thumbnail: product.thumbnail,
        spec: product.spec,
        category_id: product.category_id,
        category_name: product.category?.name || null, // <-- Thêm tên danh mục
        createdAt: formatVNDateTime(product.createdAt),
        updatedAt: formatVNDateTime(product.updatedAt),
        colors,
      },
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const getProductDetailUser = async (req, res) => {
  try {
    const { product_id } = req.params;

    const product = await model.products.findByPk(product_id, {
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "status",
        "thumbnail",
        "spec",
        "category_id",
      ],
      include: [
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: ["product_variant_id", "color", "size", "stock", "sku"],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name"],
        },
      ],
    });

    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Gom ảnh theo màu
    const imagesByColor = {};
    product.product_images.forEach((img) => {
      if (!imagesByColor[img.color]) imagesByColor[img.color] = [];
      imagesByColor[img.color].push(img.image);
    });

    return res.status(200).json({
      message: "Lấy thông tin chi tiết sản phẩm thành công",
      data: {
        ...product.toJSON(),
        images_by_color: imagesByColor,
      },
    });
  } catch (error) {
    console.error("Lỗi getProductDetailUser:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const updateProductStatus = async (req, res) => {
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

    // Đổi trạng thái
    if (product.status === "active") {
      product.status = "inactive"; // Ẩn sản phẩm
      await product.save();
      return res.status(200).json({
        message: "Sản phẩm đã được ẩn thành công",
        data: {
          product_id: product.product_id,
          name: product.name,
          status: product.status,
        },
      });
    } else {
      product.status = "active"; // Hiển thị sản phẩm
      await product.save();
      return res.status(200).json({
        message: "Sản phẩm đã được hiển thị lại thành công",
        data: {
          product_id: product.product_id,
          name: product.name,
          status: product.status,
        },
      });
    }
  } catch (error) {
    console.error("Lỗi toggleProductStatus:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const updateThumbnailProduct = async (req, res) => {
  try {
    const { product_id } = req.params;
    if (!product_id)
      return res.status(400).json({ message: "product_id là bắt buộc" });
    if (!req.file)
      return res.status(400).json({ message: "Vui lòng upload 1 ảnh" });

    // Tìm sản phẩm
    const product = await model.products.findByPk(product_id, {
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });
    if (!product)
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });

    // Xóa thumbnail cũ trên Cloudinary nếu có
    if (product.thumbnail) {
      try {
        const publicId = product.thumbnail.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(
          `products/${product_id}/thumbnail/${publicId}`
        );
      } catch (err) {
        console.warn("Không xóa được thumbnail cũ:", err.message);
      }
    }

    // Upload thumbnail mới lên Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: `products/${product_id}/thumbnail`, // <-- backtick để interpolate product_id
      resource_type: "image",
    });

    // Xóa file tạm
    try {
      await fs.unlink(req.file.path);
    } catch (err) {
      console.warn("Không xóa được file tạm:", err.message);
    }

    // Cập nhật DB
    product.thumbnail = result.secure_url;
    await product.save();

    // Lấy lại product + category
    const fullProduct = await model.products.findOne({
      where: { product_id },
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });

    const p = fullProduct.get({ plain: true });

    const responseData = {
      product_id: p.product_id,
      name: p.name,
      description: p.description,
      discount: p.discount,
      status: p.status,
      thumbnail: p.thumbnail,
      spec: p.spec,
      createdAt: formatVNDateTime(p.createdAt),
      updatedAt: formatVNDateTime(p.updatedAt),
      category_id: p.category_id,
      category_name: p.category?.name || null,
    };

    return res.status(200).json({
      message: "Cập nhật thumbnail sản phẩm thành công",
      data: responseData,
    });
  } catch (error) {
    console.error("Lỗi cập nhật thumbnail:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const updateImagesProductByColor = async (req, res) => {
  try {
    const { color } = req.body;
    const files = req.files;
    const { product_id } = req.params; // lấy từ URL

    if (!product_id || !color) {
      return res.status(400).json({ message: "Thiếu product_id hoặc color" });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Vui lòng upload ít nhất 1 ảnh" });
    }
    // ✅ Kiểm tra số lượng ảnh trước khi upload
    if (files.length > 10) {
      return res
        .status(400)
        .json({ message: "Chỉ được upload tối đa 10 ảnh mỗi lần" });
    }

    // Kiểm tra product tồn tại
    const product = await model.products.findByPk(product_id);
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Kiểm tra color tồn tại trong product_variants
    const existingVariants = await model.product_variants.findAll({
      where: { product_id },
      attributes: ["color"],
      raw: true,
    });

    const variantColors = existingVariants.map((v) => v.color);
    if (!variantColors.includes(color)) {
      return res.status(400).json({
        message: `Màu "${color}" không tồn tại trong sản phẩm này`,
      });
    }

    // =============================
    // 1) XÓA TOÀN BỘ ẢNH CŨ CỦA COLOR TRÊN CLOUDINARY + DB
    // =============================
    const oldImages = await model.product_images.findAll({
      where: { product_id, color },
      raw: true,
    });

    for (const img of oldImages) {
      try {
        const publicId = img.image.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(
          `products/${product_id}/${color}/${publicId}`
        );
      } catch (err) {
        console.warn("Không xóa được ảnh cũ:", err.message);
      }
    }

    await model.product_images.destroy({ where: { product_id, color } });

    // =============================
    // 2) UPLOAD ẢNH MỚI
    // =============================
    const uploadedImages = [];

    for (const file of files) {
      let result;
      if (file.path) {
        result = await cloudinary.uploader.upload(file.path, {
          folder: `products/${product_id}/${color}`,
        });
        try {
          await fs.unlink(file.path);
        } catch (err) {
          console.warn(err.message);
        }
      } else if (file.buffer) {
        result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: `products/${product_id}/${color}` },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(file.buffer);
        });
      }

      await model.product_images.create({
        product_id,
        color,
        image: result.secure_url,
      });

      uploadedImages.push(result.secure_url);
    }

    // =============================
    // 3) LẤY TOÀN BỘ ẢNH CỦA PRODUCT (GROUP THEO COLOR)
    // =============================
    const allImages = await model.product_images.findAll({
      where: { product_id },
      attributes: ["color", "image"],
      raw: true,
    });

    const colorsGrouped = Object.values(
      allImages.reduce((acc, cur) => {
        if (!acc[cur.color]) acc[cur.color] = { color: cur.color, images: [] };
        acc[cur.color].images.push(cur.image);
        return acc;
      }, {})
    );

    // =============================
    // 4) LẤY THÔNG TIN PRODUCT + CATEGORY
    // =============================
    const fullProduct = await model.products.findOne({
      where: { product_id },
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });

    const p = fullProduct.get({ plain: true });

    const productData = {
      product_id: p.product_id,
      category_id: p.category_id,
      category_name: p.category?.name || null,
      name: p.name,
      description: p.description,
      discount: p.discount,
      status: p.status,
      thumbnail: p.thumbnail,
      spec: p.spec,
      createdAt: formatVNDateTime(p.createdAt),
      updatedAt: formatVNDateTime(p.updatedAt),
      colors: colorsGrouped,
    };

    return res.status(200).json({
      message: "Cập nhật ảnh biến thể thành công",
      data: productData,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Lỗi server",
      error: error.message,
    });
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
  getActiveProducts,
  getProductByKeyWordAdmin,
  getProductByKeyWordUser,
  addThumbnailProduct,
  addImageProductByColor,
  getProductDetailAdmin,
  getProductDetailUser,
  updateProductStatus,
  updateThumbnailProduct,
  updateImagesProductByColor,
  addFullProduct,
};
