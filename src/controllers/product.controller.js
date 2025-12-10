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

// async function safeUnlink(filePath) {
//   if (!filePath) return;
//   try {
//     await fs.unlink(filePath);
//   } catch (err) {
//     if (err.code !== "ENOENT") console.error("Xóa file tạm lỗi:", err.message);
//   }
// }

// async function clearFiles(files) {
//   if (!files) return;
//   for (const f of files) {
//     await safeUnlink(f.path);
//   }
// }

// function sendError(res, files, msg) {
//   return clearFiles(files).then(() => res.status(400).json({ message: msg }));
// }

const addFullProduct = async (req, res) => {
  const filesToDelete = new Set();

  const markForDeletion = (path) => {
    if (path && typeof path === "string") filesToDelete.add(path);
  };

  const cleanupAllTempFiles = async () => {
    if (filesToDelete.size === 0) return;
    for (const path of filesToDelete) {
      try {
        await fs.unlink(path);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error("Lỗi xóa file tạm:", path, err.message);
        }
      }
    }
    filesToDelete.clear();
  };

  const sendError = async (msg) => {
    await cleanupAllTempFiles();
    return res.status(400).json({ message: msg });
  };

  const t = await sequelize.transaction();

  try {
    req.files?.forEach((file) => markForDeletion(file.path));

    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      Object.keys(req.body).forEach((key) => {
        if (typeof req.body[key] === "string") {
          req.body[key] = req.body[key].trim();
        }
      });
    }

    const {
      name,
      category_id,
      description = "",
      price,
      discount,
      spec = "",
      product_variants,
    } = req.body || {};

    if (!name) return sendError("Tên sản phẩm không được để trống");
    if (!category_id) return sendError("Danh mục không được để trống");
    if (!price) return sendError("Giá không được để trống");

    if (!/^[a-zA-Z0-9À-ỹ\s]+$/.test(name))
      return sendError("Tên sản phẩm chỉ được chứa chữ, số và khoảng trắng");

    if (name.length < 10) {
      return sendError("Tên sản phẩm phải có ít nhất 10 ký tự");
    }

    const category = await model.categories.findByPk(category_id);
    if (!category) return sendError("Danh mục không tồn tại");

    const existingProduct = await model.products.findOne({
      where: { name, category_id },
    });
    if (existingProduct)
      return sendError("Tên sản phẩm đã tồn tại trong danh mục");

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 40000 || numPrice > 10000000)
      return sendError("Giá phải từ 40.000 → 10.000.000");

    let finalDiscount = 0;
    if (discount !== undefined && discount !== null && discount !== "") {
      const numericDiscount = Number(discount);
      if (
        !Number.isInteger(numericDiscount) ||
        numericDiscount < 0 ||
        numericDiscount > 99
      )
        return sendError("Mức giảm giá phải là số nguyên từ 0 đến 99");
      finalDiscount = numericDiscount;
    }

    if (description && !/^[\p{L}0-9\s.,!?:;"'()-]+$/u.test(description)) {
      return sendError(
        "Mô tả chỉ được chứa chữ, số, khoảng trắng và dấu câu cơ bản"
      );
    }

    let specArray = [];
    if (spec && spec.trim() !== "") {
      try {
        const parsed = JSON.parse(spec);
        if (!Array.isArray(parsed)) return sendError("Spec phải là JSON array");

        const forbiddenChars = /[<>;"'\\]/;
        for (const item of parsed) {
          if (
            typeof item !== "object" ||
            !item.label ||
            !item.value ||
            typeof item.label !== "string" ||
            typeof item.value !== "string"
          ) {
            return sendError("Spec phải gồm {label: string, value: string}");
          }
          const label = item.label.trim();
          const value = item.value.trim();
          if (!label || !value)
            return sendError("Label và Value spec không được để trống");
          if (forbiddenChars.test(label) || forbiddenChars.test(value))
            return sendError("Label/Value spec chứa ký tự không cho phép");
        }
        specArray = parsed.map((i) => ({
          label: i.label.trim(),
          value: i.value.trim(),
        }));
      } catch {
        return sendError("Spec phải là JSON hợp lệ");
      }
    }

    let variantsArr = [];
    if (product_variants) {
      try {
        variantsArr = JSON.parse(product_variants);
      } catch {
        return sendError("Biến thể sản phẩm phải là JSON hợp lệ");
      }
    }
    if (!Array.isArray(variantsArr) || variantsArr.length === 0)
      return sendError("Phải có ít nhất 1 biến thể sản phẩm");

    const cleanVariants = [];
    const variantKeySet = new Set();
    const VALID_SIZES = ["S", "M", "L", "XL", "XXL", "FREESIZE"];

    for (const v of variantsArr) {
      const color = v.color?.trim();
      if (!color) return sendError("Màu sắc không được để trống");
      if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(color))
        return sendError("Màu sắc chỉ được chứa chữ và khoảng trắng");

      let size = null;

      if (v.size !== undefined && v.size !== null) {
        const raw = String(v.size).trim();

        if (/^null$/i.test(raw)) {
          return sendError(
            `Không được gửi "null" dưới dạng chuỗi cho size. Chỉ chấp nhận: ${VALID_SIZES.join(
              ", "
            )} hoặc để trống.`
          );
        }

        if (raw !== "") {
          const upper = raw.toUpperCase();
          if (!VALID_SIZES.includes(upper)) {
            return sendError(
              `Kích thước không hợp lệ: "${
                v.size
              }". Chỉ chấp nhận: ${VALID_SIZES.join(", ")}`
            );
          }
          size = upper;
        }
      }

      const stock = Number(v.stock);
      if (isNaN(stock) || stock <= 0 || stock > 10000)
        return sendError(`Số lượng phải từ 1 đến 10000 cho màu ${color}`);

      const key = `${color}-${size || "NOSIZE"}`;
      if (variantKeySet.has(key))
        return sendError(
          `Trùng biến thể: ${color} - ${size || "Không có size"}`
        );
      variantKeySet.add(key);

      cleanVariants.push({ color, size, stock });
    }

    const thumbnailFiles =
      req.files?.filter((f) => f.fieldname === "thumbnail") || [];
    if (thumbnailFiles.length !== 1)
      return sendError("Phải upload đúng 1 ảnh thumbnail");

    const variantFiles =
      req.files?.filter((f) => f.fieldname !== "thumbnail") || [];
    if (variantFiles.length === 0)
      return sendError("Phải upload ít nhất 1 ảnh cho biến thể");

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
      try {
        fieldName = decodeURIComponent(fieldName);
      } catch {}
      const match = fieldName.match(/^images\[(.+?)\]\[\]$/);
      if (!match) return;
      const key = match[1]
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
      if (files.length === 0)
        return sendError(`Phải upload ít nhất 1 ảnh cho màu ${v.color}`);
      if (files.length > 10)
        return sendError(`Màu ${v.color} chỉ được upload tối đa 10 ảnh`);
    }

    const newProduct = await model.products.create(
      {
        name,
        category_id,
        description,
        thumbnail: null,
        price: numPrice,
        discount: finalDiscount,
        spec: specArray,
        status: "đang bán",
      },
      { transaction: t }
    );

    const createdVariants = [];
    for (const v of cleanVariants) {
      const variant = await model.product_variants.create(
        {
          product_id: newProduct.product_id,
          color: v.color,
          size: v.size,
          stock: v.stock,
          sku: buildSKU(category.name, newProduct.product_id, v.color, v.size),
        },
        { transaction: t }
      );
      createdVariants.push(variant);  
    }

    const thumbResult = await cloudinary.uploader.upload(
      thumbnailFiles[0].path,
      {
        folder: `products/${newProduct.product_id}/thumbnail`,
        public_id: `thumb_${Date.now()}`,
      }
    );
    await newProduct.update(
      { thumbnail: thumbResult.secure_url },
      { transaction: t }
    );
    markForDeletion(thumbnailFiles[0].path);

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
        await model.product_images.create(
          {
            product_id: newProduct.product_id,
            color,
            image: result.secure_url,
          },
          { transaction: t }
        );
        imagesByColor[color].push(result.secure_url);
        markForDeletion(file.path);
      }
    }

    const colorsGrouped = Object.keys(imagesByColor).map((color) => ({
      color,
      images: imagesByColor[color],
    }));

    await t.commit();
    await cleanupAllTempFiles();

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      data: {
        product_id: newProduct.product_id,
        name: newProduct.name,
        description: newProduct.description,
        thumbnail: newProduct.thumbnail,
        price: newProduct.price,
        discount: newProduct.discount,
        spec: specArray,
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
    await t.rollback();
    await cleanupAllTempFiles();
    console.error("Lỗi addFullProduct:", err);

    if (err.name === "SequelizeDatabaseError" && err.parent?.code === "22P02") {
      return res.status(400).json({
        message:
          'Giá trị kích thước không hợp lệ. Không được gửi "null" dưới dạng chuỗi.',
      });
    }

    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

const addProductVariant = async (req, res) => {
  const filesToDelete = new Set();

  const markForDeletion = (path) => {
    if (path && typeof path === "string") filesToDelete.add(path);
  };

  const cleanupAllTempFiles = async () => {
    if (filesToDelete.size === 0) return;
    for (const path of filesToDelete) {
      try {
        await fs.unlink(path);
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error("Lỗi xóa file tạm:", path, err.message);
        }
      }
    }
    filesToDelete.clear();
  };

  const sendError = async (msg) => {
    await cleanupAllTempFiles();
    return res.status(400).json({ message: msg });
  };

  try {
    req.files?.forEach((file) => markForDeletion(file.path));

    Object.keys(req.body).forEach((key) => {
      if (typeof req.body[key] === "string")
        req.body[key] = req.body[key].trim();
    });

    const { product_id } = req.params;
    if (!product_id) return sendError("Thiếu product_id trong URL");

    const product = await model.products.findByPk(product_id, {
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });
    if (!product) return sendError("Sản phẩm không tồn tại");

    let variants = [];
    try {
      variants = JSON.parse(req.body.variants);
    } catch {
      return sendError("Trường biến thể phải là JSON hợp lệ");
    }
    if (!Array.isArray(variants) || variants.length === 0)
      return sendError("Danh sách biến thể trống");

    const cleanVariants = [];
    for (const v of variants) {
      const color = v.color?.trim();
      const size = v.size?.trim() || null;
      const stock = Number(v.stock?.toString().trim());

      if (!color) return sendError("Màu sắc không được để trống");
      if (!/^[a-zA-ZÀ-ỹ\s]+$/.test(color))
        return sendError(
          "Màu sắc chỉ được chứa chữ, không số, không ký tự đặc biệt"
        );
      if (v.stock === undefined || v.stock === null || v.stock === "")
        return sendError(`Số lượng không được để trống cho màu ${color}`);
      if (isNaN(stock) || stock <= 0 || stock > 10000)
        return sendError(`Số lượng phải từ 1 đến 10000 cho màu ${color}`);
      if (cleanVariants.some((cv) => cv.color === color && cv.size === size))
        return sendError(`Trùng biến thể: ${color} - ${size || "No Size"}`);

      const exist = await model.product_variants.findOne({
        where: { product_id, color, size },
      });
      if (exist)
        return sendError(
          `Variant màu ${color} size ${size || "No Size"} đã tồn tại`
        );

      cleanVariants.push({ color, size, stock });
    }

    const variantFiles =
      req.files?.filter((f) => f.fieldname !== "thumbnail") || [];
    if (variantFiles.length === 0)
      return sendError("Phải upload ít nhất 1 ảnh variant");

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
      try {
        fieldName = decodeURIComponent(fieldName);
      } catch {}

      const match = fieldName.match(/^images\[(.+?)\]\[\]$/);
      if (!match) return;

      const key = match[1]
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
      if (files.length === 0)
        return sendError(`Phải upload ít nhất 1 ảnh cho màu ${v.color}`);
      if (files.length > 10)
        return sendError(`Màu ${v.color} chỉ được upload tối đa 10 ảnh`);
    }

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

    const imagesByColor = {};
    for (const color of Object.keys(variantFilesByColor)) {
      imagesByColor[color] = [];
      const folder = color
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();

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
          markForDeletion(file.path);
        }
      }
    }

    const colorsGrouped = Object.keys(imagesByColor).map((color) => ({
      color,
      images: imagesByColor[color],
    }));

    await cleanupAllTempFiles();

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
    await cleanupAllTempFiles();
    console.error("Lỗi addProductVariant:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

const updateFullProduct = async (req, res) => {
  const filesToDelete = new Set();
  const markForDeletion = (path) => path && filesToDelete.add(path);

  const cleanupAllTempFiles = async () => {
    for (const path of filesToDelete) {
      try {
        await fs.unlink(path);
      } catch (err) {
        if (err.code !== "ENOENT") console.error("Lỗi xóa file tạm:", err);
      }
    }
    filesToDelete.clear();
  };

  const sendError = async (msg) => {
    await cleanupAllTempFiles();
    return res.status(400).json({ message: msg });
  };

  function normalizeColor(color) {
    return color
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase();
  }

  const t = await sequelize.transaction();

  try {
    const product_id = req.params.product_id;
    if (!product_id) return sendError("Thiếu product_id");

    req.files?.forEach((f) => markForDeletion(f.path));

    const product = await model.products.findByPk(product_id, {
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });
    if (!product) return sendError("Sản phẩm không tồn tại");

    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
      Object.keys(req.body).forEach((k) => {
        if (typeof req.body[k] === "string") req.body[k] = req.body[k].trim();
      });
    }

    const {
      name,
      category_id,
      description,
      price,
      discount,
      spec,
      product_variants,
    } = req.body || {};

    if (name !== undefined) {
      if (!name) return sendError("Tên sản phẩm không được để trống");
      if (!/^[a-zA-Z0-9À-ỹ\s]+$/.test(name))
        return sendError(
          "Tên sản phẩm chỉ được chứa chữ cái, số và khoảng trắng"
        );
      if (name.length < 10)
        return sendError("Tên sản phẩm phải có ít nhất 10 ký tự");

      const exist = await model.products.findOne({
        where: {
          name,
          category_id: category_id ?? product.category_id,
          product_id: { [Op.ne]: product_id },
        },
      });
      if (exist) return sendError("Tên sản phẩm đã tồn tại trong danh mục");
    }

    if (price !== undefined) {
      if (price === "" || price === null)
        return sendError("Giá không được để trống");
      const numPrice = Number(price);
      if (isNaN(numPrice) || numPrice < 40000 || numPrice > 10000000)
        return sendError("Giá phải từ 40.000 → 10.000.000");
    }

    if (discount !== undefined && discount !== "") {
      const numDiscount = Number(discount);
      if (!Number.isInteger(numDiscount) || numDiscount < 0 || numDiscount > 99)
        return sendError("Mức giảm giá phải là số nguyên từ 0 đến 99");
    }

    if (
      description !== undefined &&
      description !== "" &&
      !/^[\p{L}0-9\s.,!?:;"'()-]+$/u.test(description)
    ) {
      return sendError(
        "Mô tả chỉ được chứa chữ, số, khoảng trắng và dấu câu cơ bản"
      );
    }

    let specArray = product.spec || [];
    if (spec !== undefined && spec !== null) {
      const specStr = typeof spec === "string" ? spec.trim() : "";
      if (specStr !== "") {
        try {
          const parsed = JSON.parse(specStr);
          if (!Array.isArray(parsed))
            return sendError("Spec phải là mảng JSON");
          const forbiddenChars = /[<>;"'\\]/;
          for (const item of parsed) {
            if (
              typeof item !== "object" ||
              !item.label ||
              !item.value ||
              typeof item.label !== "string" ||
              typeof item.value !== "string"
            ) {
              return sendError(
                "Mỗi spec phải có {label: string, value: string}"
              );
            }
            const label = item.label.trim();
            const value = item.value.trim();
            if (!label || !value)
              return sendError("Label và Value spec không được để trống");
            if (forbiddenChars.test(label) || forbiddenChars.test(value))
              return sendError("Label/Value spec chứa ký tự không cho phép");
          }
          specArray = parsed.map((i) => ({
            label: i.label.trim(),
            value: i.value.trim(),
          }));
        } catch {
          return sendError("Spec phải là JSON hợp lệ");
        }
      }
    }

    if (product_variants !== undefined) {
      let variants;
      try {
        variants = JSON.parse(product_variants);
      } catch {
        return sendError("product_variants phải là JSON hợp lệ");
      }

      if (!Array.isArray(variants))
        return sendError("product_variants phải là mảng");

      for (const v of variants) {
        const color = v.color?.trim();

        if (v.stock === undefined || v.stock === null || v.stock === "")
          return sendError(
            `Số lượng không được để trống cho màu ${
              color || "(không xác định)"
            }`
          );

        const numStock = Number(v.stock);
        if (isNaN(numStock) || numStock < 0 || numStock > 10000)
          return sendError(
            `Số lượng phải từ 0 → 10000 cho màu ${color || "(không xác định)"}`
          );

        const size = v.size === undefined ? null : v.size;

        const exist = await model.product_variants.findOne({
          where: { product_id, color, size },
          transaction: t,
        });

        if (!exist) {
          return sendError(
            `Không tìm thấy biến thể: ${color}${
              size !== null && size !== undefined
                ? ` - ${size}`
                : " (không size)"
            }`
          );
        }

        await model.product_variants.update(
          { stock: numStock },
          {
            where: { product_variant_id: exist.product_variant_id },
            transaction: t,
          }
        );
      }
    }

    let newThumbnailUrl = product.thumbnail;
    const thumbnailFile = req.files?.find((f) => f.fieldname === "thumbnail");
    if (thumbnailFile) {
      if (req.files.filter((f) => f.fieldname === "thumbnail").length > 1)
        return sendError("Chỉ được upload 1 ảnh thumbnail");

      if (product.thumbnail) {
        try {
          const publicId = product.thumbnail.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(
            `products/${product_id}/thumbnail/${publicId}`
          );
        } catch (err) {
          console.error("Lỗi xóa thumbnail cũ:", err);
        }
      }

      const result = await cloudinary.uploader.upload(thumbnailFile.path, {
        folder: `products/${product_id}/thumbnail`,
        public_id: `thumb_${Date.now()}`,
      });
      newThumbnailUrl = result.secure_url;
      markForDeletion(thumbnailFile.path);
    }

    const variantFiles =
      req.files?.filter((f) => f.fieldname !== "thumbnail") || [];
    if (variantFiles.length > 0) {
      const existingVariants = await model.product_variants.findAll({
        where: { product_id },
      });
      const colorMap = {};
      existingVariants.forEach((v) => {
        colorMap[normalizeColor(v.color)] = v.color;
      });

      const filesByColor = {};
      variantFiles.forEach((file) => {
        let fieldName = file.fieldname.replace(/\+/g, " ");
        try {
          fieldName = decodeURIComponent(fieldName);
        } catch {}
        const match = fieldName.match(/^images\[(.+?)\]\[\]$/);
        if (!match) return;
        const realColor = colorMap[normalizeColor(match[1])];
        if (realColor) {
          filesByColor[realColor] = filesByColor[realColor] || [];
          filesByColor[realColor].push(file);
        }
      });

      for (const [color, files] of Object.entries(filesByColor)) {
        if (files.length > 10)
          return sendError(`Màu ${color} chỉ được upload tối đa 10 ảnh`);
      }

      for (const [color, files] of Object.entries(filesByColor)) {
        const folderName = normalizeColor(color);
        try {
          await cloudinary.api.delete_resources_by_prefix(
            `products/${product_id}/${folderName}`
          );
          await cloudinary.api.delete_resources_by_prefix(
            `products/${product_id}/${folderName}/`
          );
        } catch (err) {
          console.error("Lỗi xóa ảnh cũ:", err);
        }

        await model.product_images.destroy({
          where: { product_id, color },
          transaction: t,
        });

        for (const file of files) {
          const result = await cloudinary.uploader.upload(file.path, {
            folder: `products/${product_id}/${folderName}`,
          });
          await model.product_images.create(
            {
              product_id,
              color,
              image: result.secure_url,
            },
            { transaction: t }
          );
          markForDeletion(file.path);
        }
      }
    }

    if (name !== undefined) product.name = name;
    if (category_id !== undefined) product.category_id = category_id;
    if (description !== undefined) product.description = description || "";
    if (price !== undefined) product.price = Number(price);
    if (discount !== undefined && discount !== "")
      product.discount = Number(discount);
    product.spec = specArray;
    product.thumbnail = newThumbnailUrl;

    await product.save({ transaction: t });
    await t.commit();
    await cleanupAllTempFiles();

    const updatedVariants = await model.product_variants.findAll({
      where: { product_id },
    });
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
        product_variants: updatedVariants,
        colors: colorsGrouped,
      },
    });
  } catch (err) {
    await t.rollback();
    await cleanupAllTempFiles();
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

    const colorTrimmed = color?.trim();
    if (!colorTrimmed) return sendError(res, "Màu sắc không được để trống");

    size = size?.toString().trim();
    if (!size || size === "") return sendError(res, "Size không được để trống");

    if (stock === undefined || stock === null || stock === "") {
      return sendError(res, "Số lượng không được để trống");
    }

    const stockStr = String(stock).trim();

    if (stockStr === "") {
      return sendError(res, "Số lượng không được để trống");
    }

    const stockNum = Number(stockStr);
    if (isNaN(stockNum) || stockNum < 0 || stockNum > 10000) {
      return sendError(res, "Số lượng phải là số từ 0 → 10000");
    }

    stock = stockNum;

    const product = await model.products.findByPk(product_id, {
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });
    if (!product) return sendError(res, "Sản phẩm không tồn tại");

    const existingColor = await model.product_variants.findOne({
      where: { product_id, color: colorTrimmed },
    });
    if (!existingColor) {
      return sendError(
        res,
        `Màu "${colorTrimmed}" chưa tồn tại trong sản phẩm.`
      );
    }

    const sizeExist = await model.product_variants.findOne({
      where: { product_id, color: colorTrimmed, size },
    });
    if (sizeExist) {
      return sendError(
        res,
        `Size "${size}" đã tồn tại trong màu "${colorTrimmed}".`
      );
    }

    const sku = buildSKU(
      product.category.name,
      product.product_id,
      colorTrimmed,
      size
    );

    const newVariant = await model.product_variants.create({
      product_id,
      color: colorTrimmed,
      size,
      stock,
      price: existingColor.price,
      discount: existingColor.discount,
      sku,
    });

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
      return res
        .status(400)
        .json({ message: "Danh mục cấp 1 không được để trống" });
    }

    const rootCategory = await model.categories.findByPk(root_id, {
      include: [{ model: model.categories, as: "parent" }],
    });
    if (!rootCategory)
      return res.status(404).json({ message: "Danh mục cấp 1 không tồn tại" });

    if (rootCategory.parent_id !== null)
      return res
        .status(400)
        .json({ message: "root_id không phải danh mục cấp 1" });

    const allCategories = await model.categories.findAll({
      attributes: ["category_id", "parent_id"],
      raw: true,
    });

    const childIds = getAllChildCategoryIds(allCategories, root_id);
    childIds.push(root_id);

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

    const formattedData = products.map((p) => {
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color])
          colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

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

    const formattedData = products.map((p) => {
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color])
          colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

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

    const formattedData = products.map((p) => {
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color])
          colors[img.color] = { color: img.color, images: [] };
        colors[img.color].images.push(img.image);
      });

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

    const searchTerm = `%${keyword.trim()}%`;

    const variantProducts = await model.product_variants.findAll({
      attributes: ["product_id"],
      where: {
        sku: { [Op.iLike]: `%${keyword.trim()}%` },
      },
      raw: true,
    });
    const variantProductIds = variantProducts.map((v) => v.product_id);

    const nameSearchCondition = Sequelize.where(
      Sequelize.fn("unaccent", Sequelize.col("products.name")),
      { [Op.iLike]: Sequelize.fn("unaccent", searchTerm) }
    );

    const categorySearchCondition = Sequelize.where(
      Sequelize.fn("unaccent", Sequelize.col("category.name")),
      { [Op.iLike]: Sequelize.fn("unaccent", searchTerm) }
    );

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
        createdAt: formatVNDateTime(p.createdAt),
        updatedAt: formatVNDateTime(p.updatedAt),
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

    const searchCondition = Sequelize.where(
      Sequelize.fn("unaccent", Sequelize.col("products.name")),
      "ILIKE",
      Sequelize.fn("unaccent", searchTerm)
    );

    const total = await model.products.count({
      where: {
        [Op.and]: [{ status: "đang bán" }, searchCondition],
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

    const products = await model.products.findAll({
      attributes: [
        "product_id",
        "name",
        "description",
        "discount",
        "price",
        "spec",
        "status",
        "thumbnail",
        "category_id",
        "createdAt",
        "updatedAt",
      ],
      where: {
        [Op.and]: [{ status: "đang bán" }, searchCondition],
      },
      include: [
        {
          model: model.categories,
          as: "category",
          attributes: ["category_id", "name"],
        },
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
      ],
      limit: pageSize,
      offset,
      order: [["createdAt", "DESC"]],
      distinct: true,
    });

    const formattedData = products.map((p) => {
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color])
          colors[img.color] = { color: img.color, images: [] };
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
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "Chưa cung cấp product_id" });
    }

    const product = await model.products.findByPk(id, {
      include: [
        { model: model.categories, as: "category", attributes: ["name"] },
      ],
    });
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

    if (product.status === "đang bán") {
      product.status = "ngưng bán";
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
      product.status = "đang bán";
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

    const colorsMap = {};
    const colors = [];
    product.product_images.forEach((img) => {
      if (!colorsMap[img.color]) {
        colorsMap[img.color] = { color: img.color, images: [] };
        colors.push(colorsMap[img.color]);
      }
      colorsMap[img.color].images.push(img.image);
    });

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
      return res
        .status(400)
        .json({ message: "Vui lòng nhập trạng thái sản phẩm" });
    }

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

    const formatted = products.map((p) => {
      const colorMap = {};
      p.product_images.forEach((img) => {
        if (!colorMap[img.color])
          colorMap[img.color] = { color: img.color, images: [] };
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
    const product = await model.products.findByPk(product_id, {
      transaction: t,
    });
    if (!product) {
      return res.status(404).json({ message: "Sản phẩm không tồn tại" });
    }

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

    const folderPrefix = `products/${product_id}`;
    try {
      await cloudinary.api.delete_resources_by_prefix(folderPrefix);

      await cloudinary.api.delete_folder(folderPrefix);
      console.log(`Đã xóa folder Cloudinary: ${folderPrefix}`);
    } catch (cloudErr) {
      console.error("Lỗi xóa ảnh Cloudinary:", cloudErr.message);
    }

    await model.product_images.destroy({
      where: { product_id },
      transaction: t,
    });

    await model.product_variants.destroy({
      where: { product_id },
      transaction: t,
    });

    await model.products.destroy({
      where: { product_id },
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
