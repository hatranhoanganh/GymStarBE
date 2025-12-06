import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, Sequelize } from "sequelize";
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

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Xóa file tạm lỗi:", err.message);
  }
}

async function clearFiles(files) {
  if (!files) return;
  for (const f of files) {
    await safeUnlink(f.path);
  }
}

function sendError(res, files, msg) {
  return clearFiles(files).then(() => res.status(400).json({ message: msg }));
}

const addFullProduct = async (req, res) => {
  try {
    // TRIM AN TOÀN – không crash dù req.body = null/undefined
    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === "string") {
          req.body[key] = req.body[key].trim();
        }
      });
    }

    const { name, category_id, description = "", price, discount, spec = "", product_variants } = req.body || {};

    // --- Validate product fields ---
    if (!name) return sendError(res, "Tên sản phẩm không được để trống", req.files);
    if (!category_id) return sendError(res, "Danh mục không được để trống", req.files);
    if (!price) return sendError(res, "Giá không được để trống", req.files);
    // → description và spec được phép để trống

    // Tên sản phẩm: giữ nguyên regex cũ của bạn
    if (!/^[a-zA-Z0-9À-ỹ\s]+$/.test(name))
      return sendError(res, "Tên sản phẩm chỉ được chứa chữ, số và khoảng trắng, không được có ký tự đặc biệt", req.files);

    const category = await model.categories.findByPk(category_id);
    if (!category) return sendError(res, "Danh mục không tồn tại", req.files);

    const existingProduct = await model.products.findOne({ where: { name, category_id } });
    if (existingProduct) return sendError(res, "Tên sản phẩm đã tồn tại trong danh mục", req.files);

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 40000 || numPrice > 10000000)
      return sendError(res, "Giá phải từ 40000 -> 10000000", req.files);

    // Discount – giữ nguyên logic cũ 100%
    let finalDiscount = 0;
    if (discount !== undefined && discount !== null && discount !== "") {
      const numericDiscount = Number(discount);
      if (!Number.isInteger(numericDiscount)) {
        return sendError(res, "Mức giảm giá phải là số nguyên (không chấp nhận số thập phân)", req.files);
      }
      if (numericDiscount < 0 || numericDiscount > 99) {
        return sendError(res, "Mức giảm giá phải từ 0 đến 99%", req.files);
      }
      finalDiscount = numericDiscount;
    }

    // DESCRIPTION – được phép để trống, nếu có thì chỉ chữ/số/khoảng trắng (có dấu OK)
    if (description !== "" && !/^[a-zA-ZÀ-ỹ0-9\s]+$/.test(description)) {
      return sendError(res, "Mô tả chỉ được chứa chữ, số và khoảng trắng, không ký tự đặc biệt", req.files);
    }

    // SPEC – được phép để trống, nếu có thì chỉ chữ/số/khoảng trắng (có dấu OK)
    if (spec !== "" && !/^[a-zA-ZÀ-ỹ0-9\s]+$/.test(spec)) {
      return sendError(res, "Đặc tả chỉ được chứa chữ, số và khoảng trắng, không ký tự đặc biệt", req.files);
    }

    // --- Validate product variants – giữ nguyên 100% logic cũ ---
    let variantsArr = [];
    if (product_variants) {
      try { variantsArr = JSON.parse(product_variants); } catch {
        return sendError(res, "Biến thể phải là JSON hợp lệ", req.files);
      }
    }
    if (!Array.isArray(variantsArr) || variantsArr.length === 0)
      return sendError(res, "Thiếu dữ liệu bắt buộc", req.files);

    const cleanVariants = [];
    for (const v of variantsArr) {
      const color = v.color?.trim();
      const size = v.size?.trim() || null;
      const stock = Number(v.stock);

      if (!color) return sendError(res, "Màu sắc không được để trống", req.files);
      if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(color))
        return sendError(res, "Màu sắc chỉ được chứa chữ, không số, không ký tự đặc biệt", req.files);
      if (v.stock === undefined || v.stock === null || v.stock === "")
        return sendError(res, `Số lượng không được để trống cho màu ${color}`, req.files);
      if (isNaN(stock) || stock <= 0 || stock > 10000)
        return sendError(res, `Số lượng phải từ 1 đến 10000 cho màu ${color}`, req.files);
      if (cleanVariants.some(cv => cv.color === color && cv.size === size))
        return sendError(res, `Trùng biến thể: ${color} - ${size || "No Size"}`, req.files);

      cleanVariants.push({ color, size, stock });
    }

    // === Thumbnail & Variant images – giữ nguyên 100% ===
    const thumbnailFiles = req.files?.filter((f) => f.fieldname === "thumbnail") || [];
    if (thumbnailFiles.length === 0) return sendError(res, "Phải upload ảnh thumbnail", req.files);
    if (thumbnailFiles.length > 1) return sendError(res, "Chỉ được upload 1 ảnh thumbnail", req.files);
    const thumbnailFile = thumbnailFiles[0];

    const variantFiles = req.files?.filter((f) => f.fieldname !== "thumbnail") || [];
    if (variantFiles.length === 0) return sendError(res, "Phải upload ít nhất 1 ảnh variant", req.files);

    const colorMap = {};
    cleanVariants.forEach((v) => {
      const key = v.color
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();
      colorMap[key] = v.color;
    });

    const variantFilesByColor = {};
    variantFiles.forEach((file) => {
      let fieldName = file.fieldname.replace(/\+/g, " ");
      try { fieldName = decodeURIComponent(fieldName); } catch {}
      const match = fieldName.match(/^images\[(.+?)\]\[\]$/);
      if (!match) return;
      const receivedColor = match[1];
      const key = receivedColor
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();
      const realColor = colorMap[key];
      if (!realColor) return;

      variantFilesByColor[realColor] = variantFilesByColor[realColor] || [];
      variantFilesByColor[realColor].push(file);
    });

    for (const v of cleanVariants) {
      const files = variantFilesByColor[v.color] || [];
      if (files.length === 0) {
        return sendError(res, `Phải upload ít nhất 1 ảnh cho màu ${v.color}`, req.files);
      }
      if (files.length > 20) {
        return sendError(res, `Màu ${v.color} chỉ được upload tối đa 20 ảnh`, req.files);
      }
    }

    // === Tạo sản phẩm & biến thể & upload ảnh – giữ nguyên 100% ===
    const newProduct = await model.products.create({
      name,
      category_id,
      description,
      thumbnail: null,
      discount: finalDiscount,
      spec,
      price: numPrice,
      status: "đang bán",
    });

    const createdVariants = [];
    for (const v of cleanVariants) {
      const variant = await model.product_variants.create({
        product_id: newProduct.product_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        sku: buildSKU(category.name, newProduct.product_id, v.color, v.size),
      });
      createdVariants.push(variant);
    }

    const thumbResult = await cloudinary.uploader.upload(thumbnailFile.path, {
      folder: `products/${newProduct.product_id}/thumbnail`,
      public_id: `thumb_${Date.now()}`,
    });
    newProduct.thumbnail = thumbResult.secure_url;
    await newProduct.save();
    await safeUnlink(thumbnailFile.path);

    const imagesByColor = {};
    for (const color of Object.keys(variantFilesByColor)) {
      imagesByColor[color] = [];
      const folderName = color
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();

      for (const file of variantFilesByColor[color]) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: `products/${newProduct.product_id}/${folderName}`,
        });
        imagesByColor[color].push(result.secure_url);

        await model.product_images.create({
          product_id: newProduct.product_id,
          color,
          image: result.secure_url,
        });
        await safeUnlink(file.path);
      }
    }

    const colorsGrouped = Object.keys(imagesByColor).map((color) => ({
      color,
      images: imagesByColor[color],
    }));

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data: {
        product_id: newProduct.product_id,
        name: newProduct.name,
        description: newProduct.description,
        thumbnail: newProduct.thumbnail,
        price: newProduct.price,
        discount: newProduct.discount,
        spec: newProduct.spec,
        status: newProduct.status,
        category_id,
        category_name: category.name,
        product_variants: createdVariants.map((v) => ({
          product_variant_id: v.product_variant_id,
          color: v.color,
          size: v.size,
          stock: v.stock,
          sku: v.sku,
        })),
        colors: colorsGrouped,
      },
    });

  } catch (err) {
    req.files?.forEach((f) => safeUnlink(f.path));
    console.error(err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }

  async function safeUnlink(filePath) {
    if (!filePath) return;
    try { await fs.unlink(filePath); } catch {}
  }

  function sendError(res, msg, files) {
    files?.forEach((f) => safeUnlink(f.path));
    return res.status(400).json({ message: msg });
  }
};


const addProductVariant = async (req, res) => {
  try {
    Object.keys(req.body).forEach(key => { if (typeof req.body[key] === "string") req.body[key] = req.body[key].trim(); });

    const { product_id } = req.params;
    if (!product_id) return sendError(res, "Thiếu product_id trong URL", req.files);

    const product = await model.products.findByPk(product_id, { include: [{ model: model.categories, as: "category", attributes: ["name"] }] });
    if (!product) return sendError(res, "Sản phẩm không tồn tại", req.files);

    let variants = [];
    try { variants = JSON.parse(req.body.variants); } catch { return sendError(res, "Trường biến thể phải là JSON hợp lệ", req.files); }
    if (!Array.isArray(variants) || variants.length === 0) return sendError(res, "Danh sách biến thể trống", req.files);

    const cleanVariants = [];
    for (const v of variants) {
      const color = v.color?.trim();
      const size = v.size?.trim() || null;
      const stock = Number(v.stock?.toString().trim());

      if (!color) return sendError(res, "Màu sắc không được để trống", req.files);
      if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(color)) return sendError(res, "Màu sắc chỉ được chứa chữ, không số, không ký tự đặc biệt", req.files);
      if (v.stock === undefined || v.stock === null || v.stock === "") return sendError(res, `Số lượng không được để trống cho màu ${color}`, req.files);
      if (isNaN(stock) || stock <= 0 || stock > 10000) return sendError(res, `Số lượng phải từ 1 đến 10000 cho màu ${color}`, req.files);
      if (cleanVariants.some(cv => cv.color === color && cv.size === size)) return sendError(res, `Trùng biến thể: ${color} - ${size || "No Size"}`, req.files);

      const exist = await model.product_variants.findOne({ where: { product_id, color, size } });
      if (exist) return sendError(res, `Variant màu ${color} size ${size} đã tồn tại`, req.files);

      cleanVariants.push({ color, size, stock });
    }

    // --- Validate file input ---
    const variantFiles =
      req.files?.filter((f) => f.fieldname !== "thumbnail") || [];
    if (variantFiles.length === 0) {
      return sendError(res, "Phải upload ít nhất 1 ảnh variant", req.files);
    }

    // --- Tạo map màu không dấu ---
    const colorMap = {};
    cleanVariants.forEach((v) => {
      const key = v.color
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();
      colorMap[key] = v.color;
    });

    // --- Gom file theo màu ---
    const variantFilesByColor = {};
    variantFiles.forEach((file) => {
      let fieldName = file.fieldname.replace(/\+/g, " ");
      try {
        fieldName = decodeURIComponent(fieldName);
      } catch {}

      const match = fieldName.match(/^images\[(.+?)\]\[\]$/);
      if (!match) return;

      const receivedColor = match[1];
      const key = receivedColor
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();

      const realColor = colorMap[key];
      if (!realColor) return;

      variantFilesByColor[realColor] = variantFilesByColor[realColor] || [];
      variantFilesByColor[realColor].push(file);
    });

    // --- Ràng buộc mỗi màu có ít nhất 1 ảnh, tối đa 20 ảnh ---
    for (const v of cleanVariants) {
      const files = variantFilesByColor[v.color] || [];
      if (files.length === 0)
        return sendError(
          res,
          `Phải upload ít nhất 1 ảnh cho màu ${v.color}`,
          req.files
        );
      if (files.length > 20)
        return sendError(
          res,
          `Màu ${v.color} chỉ được upload tối đa 20 ảnh`,
          req.files
        );
    }

    // ============================
    //  >>> Tạo DB từ đây
    // ============================

    // --- Tạo variants ---
    const createdVariants = [];
    for (const v of cleanVariants) {
      const sku = buildSKU(product.category.name, product_id, v.color, v.size);
      const newVar = await model.product_variants.create({
        product_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        sku,
      });
      createdVariants.push(newVar);
    }

    // --- Upload ảnh variant ---
    const imagesByColor = {};
    for (const color of Object.keys(variantFilesByColor)) {
      imagesByColor[color] = [];

      const folder = color
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");

      for (const file of variantFilesByColor[color]) {
        try {
          const result = await cloudinary.uploader.upload(file.path, {
            folder: `products/${product_id}/${folder}`,
          });
          imagesByColor[color].push(result.secure_url);

          await model.product_images.create({
            product_id,
            color,
            image: result.secure_url,
          });
        } catch (err) {
          console.error("Upload ảnh biến thể lỗi:", err.message);
        } finally {
          await safeUnlink(file.path);
        }
      }
    }

    // --- Format response ---
    const colorsGrouped = Object.keys(imagesByColor).map((color) => ({
      color,
      images: imagesByColor[color],
    }));

    return res.status(201).json({
      message: "Thêm biến thể thành công",
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
        product_variants: createdVariants.map((v) => ({
          product_variant_id: v.product_variant_id,
          color: v.color,
          size: v.size,
          stock: v.stock,
          sku: v.sku,
        })),
        colors: colorsGrouped,
      },
    });
  } catch (err) {
    req.files?.forEach((f) => safeUnlink(f.path));
    console.error(err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }

  async function safeUnlink(filePath) {
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (err.code !== "ENOENT")
        console.error("Xóa file tạm lỗi:", err.message);
    }
  }

  function sendError(res, msg, files) {
    files?.forEach((f) => safeUnlink(f.path));
    return res.status(400).json({ message: msg });
  }
};

const updateFullProduct = async (req, res) => {
  // --- Helpers ---
  async function safeUnlink(filePath) {
    if (!filePath) return;
    try { await fs.unlink(filePath); } catch (err) {
      if (err.code !== "ENOENT") console.error("Xóa file tạm lỗi:", err.message);
    }
  }

  async function clearFiles(files) {
    if (!files || !Array.isArray(files)) return;
    await Promise.all(files.map(f => safeUnlink(f.path)));
  }

  async function sendError(msg) {
    await clearFiles(req.files);
    return res.status(400).json({ message: msg });
  }

  function normalizeColor(color) {
    return color
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase();
  }

  try {
    const product_id = req.params.product_id;
    if (!product_id) return sendError("Thiếu product_id trong URL");

    const product = await model.products.findByPk(product_id, {
      include: [{ model: model.categories, as: "category", attributes: ["name"] }],
    });
    if (!product) return sendError("Sản phẩm không tồn tại");

    // FIX 1: Trim an toàn – không lỗi khi req.body = null/undefined
    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      Object.keys(req.body).forEach(key => {
        if (typeof req.body[key] === "string") {
          req.body[key] = req.body[key].trim();
        }
      });
    }

    // FIX 2: Destructuring an toàn
    const {
      name,
      category_id,
      description,
      price,
      discount,
      spec,
      product_variants
    } = req.body || {};

    // === Tên sản phẩm ===
    if (name !== undefined) {
      if (!name) return sendError("Tên sản phẩm không được để trống");
      if (!/^[a-zA-Z0-9À-ỹ\s]+$/.test(name))
        return sendError("Tên sản phẩm chỉ được chứa chữ, số và khoảng trắng, không ký tự đặc biệt");

      const exist = await model.products.findOne({
        where: {
          name,
          category_id: category_id ?? product.category_id,
          product_id: { [Op.ne]: product_id }
        }
      });
      if (exist) return sendError("Tên sản phẩm đã tồn tại trong danh mục");
      product.name = name;
    }

    // === Danh mục ===
    if (category_id !== undefined) {
      if (!category_id) return sendError("Danh mục không được để trống");
      const category = await model.categories.findByPk(category_id);
      if (!category) return sendError("Danh mục không tồn tại");
      product.category_id = category_id;
    }

    // === Mô tả – được phép để trống, nếu có thì chỉ chữ/số/khoảng trắng ===
    if (description !== undefined) {
      if (description !== "" && !/^[a-zA-Z0-9À-ỹ\s]+$/.test(description)) {
        return sendError("Mô tả chỉ được chứa chữ, số và khoảng trắng, không ký tự đặc biệt");
      }
      product.description = description;
    }

    // === Giá ===
    if (price !== undefined) {
      if (price === "" || price === null) return sendError("Giá không được để trống");
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 40000 || numPrice > 10000000)
        return sendError("Giá phải từ 40.000 → 10.000.000");
      product.price = numPrice;
    }

    // === Discount – chỉ số nguyên 0-99, được bỏ trống ===
    if (discount !== undefined && discount !== "") {
      const numDiscount = Number(discount);
      if (!Number.isInteger(numDiscount))
        return sendError("Mức giảm giá phải là số nguyên (không chấp nhận số thập phân)");
      if (numDiscount < 0 || numDiscount > 99)
        return sendError("Mức giảm giá phải từ 0 đến 99%");
      product.discount = numDiscount;
    }

    // === Thông số kỹ thuật – được phép để trống ===
    if (spec !== undefined) {
      if (spec !== "" && !/^[a-zA-Z0-9À-ỹ\s]+$/.test(spec)) {
        return sendError("Thông số kỹ thuật chỉ được chứa chữ, số và khoảng trắng, không ký tự đặc biệt");
      }
      product.spec = spec;
    }

    // === Cập nhật stock biến thể ===
    if (product_variants !== undefined) {
      let variants = [];
      try {
        variants = JSON.parse(product_variants);
      } catch {
        return sendError("product_variants phải là JSON hợp lệ");
      }

      if (!Array.isArray(variants)) return sendError("product_variants phải là mảng");

      for (const v of variants) {
        const { color, size, stock } = v;
        if (!color) return sendError("Màu sắc biến thể không được để trống");
        if (stock === undefined || stock === null || stock === "")
          return sendError(`Số lượng không được để trống cho màu ${color}`);

        const numStock = Number(stock);
        if (isNaN(numStock) || numStock < 0 || numStock > 10000)
          return sendError(`Số lượng phải từ 0 → 10000 cho màu ${color}`);

        await model.product_variants.update(
          { stock: numStock },
          { where: { product_id, color: color.trim(), size: size || null } }
        );
      }
    }

    // === Thumbnail ===
    const thumbnailFile = req.files?.find(f => f.fieldname === "thumbnail");
    if (thumbnailFile) {
      if (req.files.filter(f => f.fieldname === "thumbnail").length > 1)
        return sendError("Chỉ được upload 1 ảnh thumbnail");

      if (product.thumbnail) {
        try {
          const publicId = product.thumbnail.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`products/${product_id}/thumbnail/${publicId}`);
        } catch {}
      }

      const result = await cloudinary.uploader.upload(thumbnailFile.path, {
        folder: `products/${product_id}/thumbnail`,
        public_id: `thumb_${Date.now()}`,
      });
      product.thumbnail = result.secure_url;
      await safeUnlink(thumbnailFile.path);
    }

    await product.save();

    // === Variant images ===
    const variantFiles = req.files?.filter(f => f.fieldname !== "thumbnail") || [];
    if (variantFiles.length > 0) {
      const existingVariants = await model.product_variants.findAll({ where: { product_id } });
      const colorMap = {};
      existingVariants.forEach(v => (colorMap[normalizeColor(v.color)] = v.color));

      const filesByColor = {};
      variantFiles.forEach(file => {
        let fieldName = file.fieldname.replace(/\+/g, " ");
        try { fieldName = decodeURIComponent(fieldName); } catch {}
        const match = fieldName.match(/^images\[(.+?)\]\[\]$/);
        if (!match) return;
        const receivedColor = match[1];
        const realColor = colorMap[normalizeColor(receivedColor)];
        if (!realColor) return;

        filesByColor[realColor] = filesByColor[realColor] || [];
        filesByColor[realColor].push(file);
      });

      for (const [color, files] of Object.entries(filesByColor)) {
        if (files.length > 20) return sendError(`Màu ${color} chỉ được upload tối đa 20 ảnh`);
      }

      for (const [color, files] of Object.entries(filesByColor)) {
        const folderName = normalizeColor(color);
        try {
          await cloudinary.api.delete_resources_by_prefix(`products/${product_id}/${folderName}`);
        } catch (err) {
          console.error("Lỗi xóa ảnh cũ Cloudinary:", err.message);
        }
        await model.product_images.destroy({ where: { product_id, color } });

        for (const file of files) {
          const result = await cloudinary.uploader.upload(file.path, {
            folder: `products/${product_id}/${folderName}`
          });
          await model.product_images.create({
            product_id,
            color,
            image: result.secure_url
          });
          await safeUnlink(file.path);
        }
      }
    }

    // === Response ===
    const allImages = await model.product_images.findAll({
      where: { product_id },
      attributes: ["color", "image"],
      raw: true
    });

    const colorsGrouped = Object.values(
      allImages.reduce((acc, cur) => {
        if (!acc[cur.color]) acc[cur.color] = { color: cur.color, images: [] };
        acc[cur.color].images.push(cur.image);
        return acc;
      }, {})
    );

    return res.status(200).json({
      message: "Cập nhật sản phẩm thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        thumbnail: product.thumbnail,
        price: product.price,
        discount: product.discount,
        spec: product.spec,
        status: product.status,
        category_id: product.category_id,
        category_name: product.category?.name,
        product_variants: await model.product_variants.findAll({ where: { product_id } }),
        colors: colorsGrouped,
      },
    });

  } catch (err) {
    await clearFiles(req.files);
    console.error("Lỗi updateFullProduct:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};



const addSizeToVariant = async (req, res) => {
  function sendError(res, msg) {
    return res.status(400).json({ message: msg });
  }

  try {
    const { product_id, color } = req.params;
    let { size, stock } = req.body;

    // ====== Validate color từ params ======
    const colorTrimmed = color?.trim();
    if (!colorTrimmed) return sendError(res, "Màu sắc không được để trống");

    // ====== Validate size ======
    size = size?.toString().trim();
    if (!size || size === "") return sendError(res, "Size không được để trống");

    // ====== Validate stock – SỬA HOÀN CHỈNH TẠI ĐÂY ======
    if (stock === undefined || stock === null || stock === "") {
      return sendError(res, "Số lượng không được để trống");
    }

    // Chuyển về chuỗi để trim an toàn (dù stock là số hay chuỗi)
    const stockStr = String(stock).trim();

    // Nếu sau khi trim là chuỗi rỗng → lỗi
    if (stockStr === "") {
      return sendError(res, "Số lượng không được để trống");
    }

    const stockNum = Number(stockStr);
    if (isNaN(stockNum) || stockNum < 0 || stockNum > 10000) {
      return sendError(res, "Số lượng phải là số từ 0 → 10000");
    }
    // Gán lại stock để dùng tiếp
    stock = stockNum;

    // ====== Kiểm tra product tồn tại ======
    const product = await model.products.findByPk(product_id, {
      include: [{ model: model.categories, as: "category", attributes: ["name"] }],
    });
    if (!product) return sendError(res, "Sản phẩm không tồn tại");

    // ====== Kiểm tra màu đã tồn tại ======
    const existingColor = await model.product_variants.findOne({
      where: { product_id, color: colorTrimmed },
    });
    if (!existingColor) {
      return sendError(res, `Màu "${colorTrimmed}" chưa tồn tại trong sản phẩm.`);
    }

    // ====== Kiểm tra size trùng ======
    const sizeExist = await model.product_variants.findOne({
      where: { product_id, color: colorTrimmed, size },
    });
    if (sizeExist) {
      return sendError(res, `Size "${size}" đã tồn tại trong màu "${colorTrimmed}".`);
    }

    // ====== Tạo SKU tự động ======
    const sku = buildSKU(product.category.name, product.product_id, colorTrimmed, size);

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

    // ====== Format response giống chuẩn ======
    const formattedVariant = {
      product_variant_id: newVariant.product_variant_id,
      color: newVariant.color,
      size: newVariant.size,
      stock: newVariant.stock,
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
    console.error("addSizeToVariant error:", err);
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
      return res.status(400).json({ message: "Danh mục cấp 1 không được để trống" });
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
    childIds.push(root_id);

    // 4. Đếm tổng sản phẩm
    const total = await model.products.count({
      where: { category_id: { [Op.in]: childIds } },
    });
     if (total === 0) {
      return res.status(200).json({
        message: "Chưa có sản phẩm trong danh mục này.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }
    const totalPages = Math.ceil(total / limit);
    const validPage = Math.min(page, totalPages || 1);
    const offset = (validPage - 1) * limit;

    // 5. Lấy danh sách sản phẩm
    const products = await model.products.findAll({
      where: { category_id: { [Op.in]: childIds } },
      limit,
      offset,
      order: [["name", "ASC"]],
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "price",
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
          attributes: ["product_variant_id", "color", "size", "stock", "sku"],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
      ],
      nest: true,
    });

    // 6. Format dữ liệu
    const formattedData = products.map((p) => {
      // Gom ảnh theo màu
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color]) colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

      // Format variants
      const product_variants = p.product_variants.map((v) => ({
        product_variant_id: v.product_variant_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        sku: v.sku,
      }));

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        price: p.price,
        spec: p.spec || null,
        thumbnail: p.thumbnail,
        status: p.status,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        parent_category_name: p.category?.parent?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
        product_variants,
        colors: Object.values(colors),
      };
    });

    return res.status(200).json({
      message: "Lấy sản phẩm từ danh mục cấp 1 thành công",
      total,
      page: validPage,
      totalPages,
      data: formattedData,
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
    const products = await model.products.findAll({
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "price",
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
          attributes: ["product_variant_id", "color", "size", "stock", "sku"],
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
        },
      ],
      nest: true,
    });

    // FORMAT DỮ LIỆU
    const formattedData = products.map((p) => {
      // Gom ảnh theo màu
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color]) colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

      // Format variants
      const product_variants = p.product_variants.map((v) => ({
        product_variant_id: v.product_variant_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        sku: v.sku,
      }));

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        price: p.price,
        spec: p.spec || null,
        thumbnail: p.thumbnail,
        status: p.status,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        parent_category_name: p.category?.parent?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
        product_variants,
        colors: Object.values(colors),
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách tất cả sản phẩm thành công",
      total,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (err) {
    console.error("Lỗi getAllProducts:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};




const getActiveProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // 1. Tổng số sản phẩm active
    const total = await model.products.count({ where: { status: "đang bán" } });

    if (total === 0) {
      return res.status(200).json({
        message: "Không có sản phẩm.",
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
    const products = await model.products.findAll({
      where: { status: "đang bán" },
      limit,
      offset,
      order: [["createdAt", "DESC"]],
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "price",
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
          attributes: ["product_variant_id", "color", "size", "stock", "sku"],
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
    const formattedData = products.map((p) => {
      // Gom ảnh theo màu
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color]) colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

      // Format variants
      const product_variants = p.product_variants.map((v) => ({
        product_variant_id: v.product_variant_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        sku: v.sku,
      }));

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        price: p.price,
        spec: p.spec || null,
        thumbnail: p.thumbnail,
        status: p.status,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        parent_category_name: p.category?.parent?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
        product_variants,
        colors: Object.values(colors),
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách sản phẩm đang bán thành công",
      total,
      page: validPage,
      totalPages,
      data: formattedData,
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
    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;

    // Chuẩn hóa từ khóa tìm kiếm (chỉ để an toàn)
    const searchTerm = `%${keyword.trim()}%`;

    // 1. Tìm product_id từ variant có SKU chứa keyword (không phân biệt hoa thường)
    const variantProducts = await model.product_variants.findAll({
      attributes: ["product_id"],
      where: {
        sku: { [Op.iLike]: `%${keyword.trim()}%` },
      },
      raw: true,
    });
    const variantProductIds = variantProducts.map((v) => v.product_id);

    // 2. Điều kiện tìm kiếm tên sản phẩm + danh mục KHÔNG DẤU
    const nameSearchCondition = Sequelize.where(
      Sequelize.fn("unaccent", Sequelize.col("products.name")),
      { [Op.iLike]: Sequelize.fn("unaccent", searchTerm) }
    );

    const categorySearchCondition = Sequelize.where(
      Sequelize.fn("unaccent", Sequelize.col("category.name")),
      { [Op.iLike]: Sequelize.fn("unaccent", searchTerm) }
    );

    // 3. Đếm tổng số sản phẩm phù hợp
    const total = await model.products.count({
      where: {
        [Op.or]: [
          nameSearchCondition,
          { product_id: { [Op.in]: variantProductIds } },
        ],
      },
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: [],
          where: categorySearchCondition,
          required: false,
        },
      ],
      distinct: true,
      col: "product_id",
    });

    if (total === 0) {
      return res.status(200).json({
         message: "Không tìm thấy sản phẩm phù hợp",
        data: [],
        pagination: { total: 0, page: 1, limit: pageSize, totalPages: 0 },
      });
    }

    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;

    // 4. Lấy danh sách sản phẩm (có phân trang)
    const products = await model.products.findAll({
      where: {
        [Op.or]: [
          nameSearchCondition,
          { product_id: { [Op.in]: variantProductIds } },
        ],
      },
      include: [
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: ["product_variant_id", "sku", "color", "size", "stock"],
          required: false,
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
          required: false,
        },
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name"],
          where: categorySearchCondition,
          required: false,
        },
      ],
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
    });

    // 5. Format lại ảnh theo màu
    const formatted = products.map((p) => {
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
        price: p.price,
        spec: p.spec || null,
        status: p.status,
        thumbnail: p.thumbnail,
        category_id: p.category?.category_id || null,
        category_name: p.category?.name || null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        product_variants: p.product_variants || [],
        colors: Object.values(colorMap),
      };
    });

    return res.status(200).json({
      message: "Tìm kiếm sản phẩm thành công",
      data: formatted,
      pagination: {
        total,
        page: validPage,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (err) {
    console.error("Lỗi getProductByKeyWordAdmin:", err);
    return res.status(500).json({
      message: "Lỗi server",
      error: err.message,
    });
  }
};



const getProductByKeyWordUser = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;
    const searchTerm = `%${keyword.trim()}%`;

    // Điều kiện tìm kiếm tên không dấu
    const searchCondition = Sequelize.where(
      Sequelize.fn("unaccent", Sequelize.col("products.name")),
      "ILIKE",
      Sequelize.fn("unaccent", searchTerm)
    );

    // 1. Đếm tổng
    const total = await model.products.count({
      where: {
        [Op.and]: [
          { status: "đang bán" },
          searchCondition
        ]
      },
      distinct: true,
      col: "product_id",
    });

    if (total === 0) {
      return res.status(200).json({
        message: "Không tìm thấy sản phẩm phù hợp",
        data: [],
        pagination: { total: 0, page: 1, limit: pageSize, totalPages: 0 },
      });
    }

    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;

    // 2. Lấy danh sách
    const products = await model.products.findAll({
      attributes: [
        "product_id", "name", "description", "discount", "price",
        "spec", "status", "thumbnail", "category_id", "createdAt", "updatedAt"
      ],
      where: {
        [Op.and]: [
          { status: "đang bán" },
          searchCondition
        ]
      },
      include: [
        { model: model.categories, as: "category", attributes: ["category_id", "name"] },
        { model: model.product_variants, as: "product_variants", attributes: ["product_variant_id", "sku", "color", "size", "stock"], required: false },
        { model: model.product_images, as: "product_images", attributes: ["product_image_id", "color", "image"], required: false },
      ],
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
    });

    // 3. Format dữ liệu (giữ nguyên như cũ)
    const formattedData = products.map(p => {
      const colors = {};
      p.product_images.forEach(img => {
        if (!colors[img.color]) colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        price: p.price,
        spec: p.spec || null,
        status: p.status,
        thumbnail: p.thumbnail,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
        product_variants: p.product_variants || [],
        colors: Object.values(colors),
      };
    });

    return res.status(200).json({
      message: "Tìm kiếm sản phẩm thành công",
      data: formattedData,
      pagination: { total, page: validPage, limit: pageSize, totalPages },
    });

  } catch (err) {
    console.error("Lỗi getProductByKeyWordUser:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};




const updateProductStatus = async (req, res) => {
  try {
    const { id } = req.params; // product_id từ URL
    if (!id) {
      return res.status(400).json({ message: "Chưa cung cấp product_id" });
    }

    // Tìm sản phẩm
    const product = await model.products.findByPk(id, {
      include: [{ model: model.categories, as: "category", attributes: ["name"] }]
    });
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Đổi trạng thái
    if (product.status === "đang bán") {
      product.status = "ngưng bán"; // Ẩn sản phẩm
      await product.save();
      return res.status(200).json({
        message: "Sản phẩm đã được ẩn thành công",
        data: {
          product_id: product.product_id,
          name: product.name,
          description: product.description,
          thumbnail: product.thumbnail,
          price: product.price,
          discount: product.discount,
          spec: product.spec,
          status: product.status,
          category_id: product.category_id,
          category_name: product.category?.name || null,
        },
      });
    } else {
      product.status = "đang bán"; // Hiển thị sản phẩm
      await product.save();
      return res.status(200).json({
        message: "Sản phẩm đã được hiển thị lại thành công",
        data: {
          product_id: product.product_id,
          name: product.name,
          description: product.description,
          thumbnail: product.thumbnail,
          price: product.price,
          discount: product.discount,
          spec: product.spec,
          status: product.status,
          category_id: product.category_id,
          category_name: product.category?.name || null,
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
const getProductDetail = async (req, res) => {
  try {
    const { product_id } = req.params;

    // Lấy thông tin sản phẩm
    const product = await model.products.findByPk(product_id, {
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "price",
        "status",
        "thumbnail",
        "spec",
        "category_id",
        "createdAt",
        "updatedAt",
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
          order: [["createdAt", "ASC"]],
        },
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
      ],
      nest: true,
    });

    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // Gom ảnh theo màu
    const colorsMap = {};
    const colors = [];
    product.product_images.forEach((img) => {
      if (!colorsMap[img.color]) {
        colorsMap[img.color] = { color: img.color, images: [] };
        colors.push(colorsMap[img.color]);
      }
      colorsMap[img.color].images.push(img.image);
    });

    // Format variants
    const variants = product.product_variants.map((v) => ({
      product_variant_id: v.product_variant_id,
      color: v.color,
      size: v.size,
      stock: v.stock,
      sku: v.sku,
    }));

    return res.status(200).json({
      message: "Lấy chi tiết sản phẩm thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        description: product.description,
        discount: product.discount,
        price: product.price,
        status: product.status,
        thumbnail: product.thumbnail,
        spec: product.spec,
        category_id: product.category_id,
        category_name: product.category?.name || null,
        parent_category_name: product.category?.parent?.name || null,
        createdAt: formatVNDateTime(product.createdAt),
        updatedAt: formatVNDateTime(product.updatedAt),
        product_variants: variants,
        colors,
      },
    });
  } catch (error) {
    console.error("Lỗi getProductDetail:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const getProductsByStatus = async (req, res) => {
  try {
    const { status = "", page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    if (!status) {
      return res.status(400).json({ message: "Vui lòng nhập trạng thái sản phẩm" });
    }

    // 1. Đếm tổng sản phẩm
    const total = await model.products.count({
      where: { status },
      distinct: true,
    });

    if (total === 0) {
      return res.status(200).json({
        message: `Không có sản phẩm với trạng thái '${status}'`,
        data: [],
        pagination: { total: 0, page: 1, limit: pageSize, totalPages: 0 },
      });
    }

    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    // 2. Lấy danh sách sản phẩm phân trang
    const products = await model.products.findAll({
      where: { status },
      include: [
        {
          model: model.product_variants,
          as: "product_variants",
          attributes: ["product_variant_id", "sku", "color", "size", "stock"],
          required: false,
        },
        {
          model: model.product_images,
          as: "product_images",
          attributes: ["product_image_id", "color", "image"],
          required: false,
        },
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

    // 3. Gom ảnh theo màu
    const formatted = products.map((p) => {
      const colorMap = {};
      p.product_images.forEach((img) => {
        if (!colorMap[img.color]) colorMap[img.color] = { color: img.color, images: [] };
        colorMap[img.color].images.push(img.image);
      });

      return {
        product_id: p.product_id,
        name: p.name,
        description: p.description,
        discount: p.discount,
        price: p.price,
        spec: p.spec || null,
        status: p.status,
        thumbnail: p.thumbnail,
        category_id: p.category_id,
        category_name: p.category?.name || null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        product_variants: p.product_variants,
        colors: Object.values(colorMap),
      };
    });

    return res.status(200).json({
      message: `Lấy danh sách sản phẩm với trạng thái '${status}' thành công`,
      data: formatted,
      pagination: { total, page: validPage, limit: pageSize, totalPages },
    });
  } catch (err) {
    console.error("Lỗi getProductsByStatus:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

const deleteProduct = async (req, res) => {
  const { product_id } = req.params;
  const t = await sequelize.transaction();

  try {
    // 1. Tìm sản phẩm
    const product = await model.products.findByPk(product_id, { transaction: t });
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    // 2. Kiểm tra: có trong giỏ hàng không?
    const inCart = await model.carts.count({
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          where: { product_id },
          required: true,
        },
      ],
      transaction: t,
    });

    // 3. Kiểm tra: có trong đơn hàng không?
    const inOrder = await model.order_details.count({
      include: [
        {
          model: model.product_variants,
          as: "product_variant",
          where: { product_id },
          required: true,
        },
      ],
      transaction: t,
    });

    if (inCart > 0 || inOrder > 0) {
      return res.status(400).json({
        message: "Không thể xóa sản phẩm đã có trong giỏ hàng hoặc đơn hàng",
        details: {
          inCart: inCart > 0,
          inOrder: inOrder > 0,
          cartCount: inCart,
          orderCount: inOrder,
        },
      });
    }

    // 4. XÓA ẢNH TRÊN CLOUDINARY (toàn bộ folder sản phẩm)
    const folderPrefix = `products/${product_id}`;
    try {
      // Xóa toàn bộ folder (thumbnail + tất cả màu)
      await cloudinary.api.delete_resources_by_prefix(folderPrefix);
      // Xóa cả folder rỗng (nếu còn)
      await cloudinary.api.delete_folder(folderPrefix);
      console.log(`Đã xóa folder Cloudinary: ${folderPrefix}`);
    } catch (cloudErr) {
      console.error("Lỗi xóa ảnh Cloudinary:", cloudErr.message);
      // Không return lỗi ở đây → vẫn tiếp tục xóa DB (ảnh có thể xóa sau)
    }

    // 5. XÓA DỮ LIỆU TRONG DATABASE (cứng)
    await model.product_images.destroy({
      where: { product_id },
      transaction: t,
    });

    await model.product_variants.destroy({
      where: { product_id},
      transaction: t,
    });

    await model.products.destroy({
      where: { product_id},
      transaction: t,
    });

    await t.commit();

    return res.status(200).json({
      message: "Xóa sản phẩm thành công",
      product_id,
    });

  } catch (err) {
    await t.rollback();
    console.error("Lỗi xóa sản phẩm:", err);
    return res.status(500).json({
      message: "Lỗi server khi xóa sản phẩm",
      error: err.message,
    });
  }
};

export {
  addFullProduct,
  addProductVariant,
  updateFullProduct,
  addSizeToVariant,
  getProductByDanhMucCap1,
  getAllProducts,
  getActiveProducts,
  getProductDetail,
  getProductByKeyWordAdmin,
  getProductByKeyWordUser,
  updateProductStatus,
  getProductsByStatus,
  deleteProduct,
};
