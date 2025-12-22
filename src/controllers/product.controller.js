import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op, Sequelize } from "sequelize";
import cloudinary from "../config/cloudinary.js";
import fs from "fs/promises";

dotenv.config();
const model = initModels(sequelize);

const removeVietnameseTones = (str = "") => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
};

const buildCategoryCode = (name = "") => {
  return removeVietnameseTones(name)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();
};

const getColorCode = (color = "") => {
  return removeVietnameseTones(color)
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
};

const buildSKUWithIndex = (categoryName, productId, color, size, index) => {
  const categoryCode = buildCategoryCode(categoryName);
  const colorCode = getColorCode(color);

  let sku = `${categoryCode}${productId}-${colorCode}`;
  if (size) sku += `-${size}`;
  sku += `-${index}`;

  return sku;
};

const addFullProduct = async (req, res) => {
  const filesToDelete = new Set();
  const t = await sequelize.transaction();

  const markForDeletion = (path) => {
    if (path && typeof path === "string") filesToDelete.add(path);
  };

  const cleanupAllTempFiles = async () => {
    for (const path of filesToDelete) {
      try {
        await fs.unlink(path);
      } catch (err) {}
    }
    filesToDelete.clear();
  };

  const sendError = async (msg) => {
    await t.rollback();
    await cleanupAllTempFiles();
    return res.status(400).json({ message: msg });
  };

  try {
    // ===== MARK TEMP FILES =====
    req.files?.forEach((f) => markForDeletion(f.path));

    // ===== TRIM BODY =====
    Object.keys(req.body || {}).forEach((k) => {
      if (typeof req.body[k] === "string") req.body[k] = req.body[k].trim();
    });

    const {
      name,
      category_id,
      description = "",
      price,
      discount,
      spec = "",
      product_variants,
    } = req.body;

    // ===== VALIDATE BASIC =====
    if (!name) return sendError("Tên sản phẩm không được để trống");
    if (!category_id) return sendError("Danh mục không được để trống");
    if (!price) return sendError("Giá không được để trống");

    if (name.length < 10)
      return sendError("Tên sản phẩm phải có ít nhất 10 ký tự");

    const category = await model.categories.findByPk(category_id);
    if (!category) return sendError("Danh mục không tồn tại");

    const existed = await model.products.findOne({
      where: { name, category_id },
    });
    if (existed) return sendError("Tên sản phẩm đã tồn tại trong danh mục");

    const numPrice = Number(price);
    if (isNaN(numPrice) || numPrice < 40000 || numPrice > 10000000)
      return sendError("Giá phải từ 40.000 → 10.000.000");

    let finalDiscount = 0;
    if (discount !== undefined && discount !== "") {
      const d = Number(discount);
      if (!Number.isInteger(d) || d < 0 || d > 99)
        return sendError("Giảm giá phải từ 0 đến 99");
      finalDiscount = d;
    }

    // ===== SPEC =====
    let specArray = [];
    if (spec) {
      try {
        const parsed = JSON.parse(spec);
        if (!Array.isArray(parsed)) return sendError("Spec phải là mảng");
        specArray = parsed;
      } catch {
        return sendError("Spec không hợp lệ");
      }
    }

    // ===== VARIANTS =====
    let variantsArr;
    try {
      variantsArr = JSON.parse(product_variants);
    } catch {
      return sendError("product_variants phải là JSON hợp lệ");
    }

    if (!Array.isArray(variantsArr) || variantsArr.length === 0)
      return sendError("Phải có ít nhất 1 biến thể");

    const VALID_SIZES = ["S", "M", "L", "XL", "XXL", "FREESIZE"];
    const cleanVariants = [];
    const variantKeySet = new Set();

    for (const v of variantsArr) {
      const color = v.color?.trim();
      if (!color) return sendError("Màu sắc không được để trống");

      let size = null;
      if (v.size && VALID_SIZES.includes(String(v.size).toUpperCase()))
        size = String(v.size).toUpperCase();

      const stock = Number(v.stock);
      if (!Number.isInteger(stock) || stock <= 0 || stock > 10000)
        return sendError(`Stock không hợp lệ cho màu ${color}`);

      const key = `${color}-${size || "NOSIZE"}`;
      if (variantKeySet.has(key)) return sendError(`Trùng biến thể: ${key}`);

      variantKeySet.add(key);
      cleanVariants.push({ color, size, stock });
    }

    // ===== THUMBNAIL =====
    const thumbnailFiles =
      req.files?.filter((f) => f.fieldname === "thumbnail") || [];

    if (thumbnailFiles.length !== 1)
      return sendError("Phải upload đúng 1 thumbnail");

    const thumb = thumbnailFiles[0];
    if (!thumb.mimetype.startsWith("image"))
      return sendError("Thumbnail phải là ảnh");

    // ===== VARIANT MEDIA =====
    const variantFiles =
      req.files?.filter((f) => f.fieldname !== "thumbnail") || [];

    if (variantFiles.length === 0)
      return sendError("Phải upload media cho biến thể");

    const normalize = (str) =>
      str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_")
        .toLowerCase();

    const colorMap = {};
    cleanVariants.forEach((v) => {
      colorMap[normalize(v.color)] = v.color;
    });

    const filesByColor = {};
    for (const file of variantFiles) {
      let field = decodeURIComponent(file.fieldname.replace(/\+/g, " "));
      const match = field.match(/^images\[(.+?)\]\[\]$/);
      if (!match) continue;

      const realColor = colorMap[normalize(match[1])];
      if (!realColor) continue;

      filesByColor[realColor] ||= [];
      filesByColor[realColor].push(file);
    }

    // validate theo COLOR
    for (const color of Object.keys(filesByColor)) {
      const files = filesByColor[color];
      const images = files.filter((f) => f.mimetype.startsWith("image"));
      const videos = files.filter((f) => f.mimetype.startsWith("video"));

      if (images.length > 5) return sendError(`Màu ${color} tối đa 5 ảnh`);
      if (videos.length > 1) return sendError(`Màu ${color} tối đa 1 video`);
    }

    // ===== CREATE PRODUCT =====
    const newProduct = await model.products.create(
      {
        name,
        category_id,
        description,
        price: numPrice,
        discount: finalDiscount,
        spec: specArray,
        status: "đang bán",
        thumbnail: null,
      },
      { transaction: t }
    );

   
    let skuIndex = 1;
    for (const v of cleanVariants) {
      const sku = buildSKUWithIndex(
        category.name,
        newProduct.product_id,
        v.color,
        v.size,
        skuIndex++
      );

      await model.product_variants.create(
        {
          product_id: newProduct.product_id,
          color: v.color,
          size: v.size,
          stock: v.stock,
          sku,
        },
        { transaction: t }
      );
    }

  
    const thumbResult = await cloudinary.uploader.upload(thumb.path, {
      folder: `products/${newProduct.product_id}/thumbnail`,
    });

    await newProduct.update(
      { thumbnail: thumbResult.secure_url },
      { transaction: t }
    );


    for (const color of Object.keys(filesByColor)) {
      const folder = normalize(color);

      for (const file of filesByColor[color]) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: `products/${newProduct.product_id}/${folder}`,
          resource_type: "auto",
        });

        await model.product_images.create(
          {
            product_id: newProduct.product_id,
            color,
            image: result.secure_url,
          },
          { transaction: t }
        );

        markForDeletion(file.path);
      }
    }

    await t.commit();
    await cleanupAllTempFiles();

    return res.status(201).json({
      message: "Tạo sản phẩm thành công",
      product_id: newProduct.product_id,
    });
  } catch (err) {
    await t.rollback();
    await cleanupAllTempFiles();
    console.error("addFullProduct ERROR:", err);
    return res.status(500).json({
      message: "Lỗi server",
      error: err.message,
    });
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
      return sendError(
        "Phải upload ít nhất 1 file (ảnh hoặc video) cho variant"
      );

   
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
        return sendError(
          `Phải upload ít nhất 1 file (ảnh hoặc video) cho màu ${v.color}`
        );

      if (files.length > 10)
        return sendError(`Màu ${v.color} chỉ được upload tối đa 10 file`);

      const videos = files.filter((f) => f.mimetype.startsWith("video"));
      const images = files.filter((f) => f.mimetype.startsWith("image"));

      if (images.length > 5)
        return sendError(`Màu ${v.color} chỉ được upload tối đa 5 ảnh`);

      if (videos.length > 1)
        return sendError(`Màu ${v.color} chỉ được upload tối đa 1 video`);

      for (const img of images) {
        if (img.size > 5 * 1024 * 1024)
          return sendError(`Ảnh màu ${v.color} không được vượt quá 5MB`);
      }

      for (const vdo of videos) {
        if (vdo.size > 100 * 1024 * 1024)
          return sendError(`Video màu ${v.color} không được vượt quá 100MB`);
      }
    }

   
    const existingVariantCount = await model.product_variants.count({
      where: { product_id },
    });

    let skuIndex = existingVariantCount + 1;
    const createdVariants = [];

    for (const v of cleanVariants) {
      const sku = buildSKUWithIndex(
        product.category.name,
        product_id,
        v.color,
        v.size,
        skuIndex
      );

      const newVar = await model.product_variants.create({
        product_id,
        color: v.color,
        size: v.size,
        stock: v.stock,
        sku,
      });

      createdVariants.push(newVar);
      skuIndex++;
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
            resource_type: "auto",
          });

          imagesByColor[color].push(result.secure_url);

          await model.product_images.create({
            product_id,
            color,
            image: result.secure_url,
          });
        } catch (err) {
          console.error("Upload media variant lỗi:", err.message);
        } finally {
          markForDeletion(file.path);
        }
      }
    }

    await cleanupAllTempFiles();

    return res.status(201).json({
      message: "Thêm biến thể thành công",
      data: {
        product_id: product.product_id,
        name: product.name,
        product_variants: createdVariants,
        colors: Object.keys(imagesByColor).map((color) => ({
          color,
          media: imagesByColor[color],
        })),
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
  const markForDeletion = (p) => p && filesToDelete.add(p);

  const cleanupAllTempFiles = async () => {
    for (const p of filesToDelete) {
      try {
        await fs.unlink(p);
      } catch (err) {
        if (err.code !== "ENOENT") console.error("Lỗi xóa file:", err);
      }
    }
    filesToDelete.clear();
  };

  const sendError = async (msg) => {
    await cleanupAllTempFiles();
    return res.status(400).json({ message: msg });
  };

  const normalizeColor = (c) =>
    c
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, "_")
      .toLowerCase();

  const t = await sequelize.transaction();

  try {
    const { product_id } = req.params;
    if (!product_id) return sendError("Thiếu product_id");

    req.files?.forEach((f) => markForDeletion(f.path));

    const product = await model.products.findByPk(product_id);
    if (!product) return sendError("Sản phẩm không tồn tại");


    if (req.body && typeof req.body === "object") {
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

    const hasBodyUpdate =
      name !== undefined ||
      category_id !== undefined ||
      description !== undefined ||
      price !== undefined ||
      discount !== undefined ||
      spec !== undefined ||
      product_variants !== undefined;

    const hasFileUpdate = req.files && req.files.length > 0;

    if (!hasBodyUpdate && !hasFileUpdate) {
      return sendError("Không có dữ liệu nào được gửi để cập nhật");
    }

    if (name !== undefined) {
      if (!name) return sendError("Tên sản phẩm không được để trống");
      if (!/^[a-zA-Z0-9À-ỹ\s]+$/.test(name))
        return sendError("Tên sản phẩm chỉ chứa chữ, số và khoảng trắng");
      if (name.length < 10) return sendError("Tên sản phẩm phải ≥ 10 ký tự");

      const existed = await model.products.findOne({
        where: {
          name,
          category_id: category_id ?? product.category_id,
          product_id: { [Op.ne]: product_id },
        },
      });
      if (existed) return sendError("Tên sản phẩm đã tồn tại trong danh mục");
    }

    if (price !== undefined) {
      const p = Number(price);
      if (isNaN(p) || p < 40000 || p > 10000000)
        return sendError("Giá phải từ 40.000 → 10.000.000");
    }

    if (discount !== undefined && discount !== "") {
      const d = Number(discount);
      if (!Number.isInteger(d) || d < 0 || d > 99)
        return sendError("Giảm giá phải từ 0 → 99");
    }

 
    let specArray = product.spec || [];
    if (spec !== undefined && spec !== "") {
      try {
        const parsed = JSON.parse(spec);
        if (!Array.isArray(parsed)) return sendError("Spec phải là mảng JSON");
        specArray = parsed;
      } catch {
        return sendError("Spec không hợp lệ");
      }
    }

    if (product_variants !== undefined) {
      let arr;
      try {
        arr = JSON.parse(product_variants);
      } catch {
        return sendError("product_variants phải là JSON");
      }

      if (!Array.isArray(arr))
        return sendError("product_variants phải là mảng");

      for (const v of arr) {
        const stock = Number(v.stock);
        if (isNaN(stock) || stock < 0 || stock > 10000)
          return sendError("Stock không hợp lệ");

        const exist = await model.product_variants.findOne({
          where: {
            product_id,
            color: v.color?.trim(),
            size: v.size ?? null,
          },
          transaction: t,
        });

        if (!exist) return sendError(`Không tìm thấy biến thể ${v.color}`);

        await exist.update({ stock }, { transaction: t });
      }
    }

  
    const thumbFiles =
      req.files?.filter((f) => f.fieldname === "thumbnail") || [];

    if (thumbFiles.length > 1) return sendError("Chỉ được upload 1 thumbnail");

    if (thumbFiles.length === 1) {
      const file = thumbFiles[0];
      if (!file.mimetype.startsWith("image"))
        return sendError("Thumbnail phải là ảnh");

      if (product.thumbnail) {
        const publicId = product.thumbnail.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(
          `products/${product_id}/thumbnail/${publicId}`
        );
      }

      const up = await cloudinary.uploader.upload(file.path, {
        folder: `products/${product_id}/thumbnail`,
      });
      product.thumbnail = up.secure_url;
    }

  
    const mediaFiles =
      req.files?.filter((f) => f.fieldname !== "thumbnail") || [];

    if (mediaFiles.length > 0) {
      const variants = await model.product_variants.findAll({
        where: { product_id },
        transaction: t,
      });

      const colorMap = {};
      variants.forEach((v) => {
        const raw = v.color.trim();
        const norm = normalizeColor(raw);
        colorMap[norm] = raw;
        
      });

      

      const filesByColor = {};

      mediaFiles.forEach((file) => {
        const decoded = decodeURIComponent(file.fieldname);
       

        const match = decoded.match(/^images\[(.+?)\]\[\]$/);
        if (!match) return;

        const inputColor = match[1].trim();
        const normInput = normalizeColor(inputColor);

     

        const realColor = colorMap[normInput];
        if (!realColor) {
          
          return;
        }

        filesByColor[realColor] = filesByColor[realColor] || [];
        filesByColor[realColor].push(file);
      });

    

      for (const [color, files] of Object.entries(filesByColor)) {
        const images = files.filter((f) => f.mimetype.startsWith("image"));
        const videos = files.filter((f) => f.mimetype.startsWith("video"));

        if (files.length > 10) return sendError(`Màu ${color} tối đa 10 file`);
        if (images.length > 5) return sendError(`Màu ${color} tối đa 5 ảnh`);
        if (videos.length > 1) return sendError(`Màu ${color} tối đa 1 video`);

        const folder = normalizeColor(color);

       
        await cloudinary.api.delete_resources_by_prefix(
          `products/${product_id}/${folder}`,
          { resource_type: "image" }
        );

       
        await cloudinary.api.delete_resources_by_prefix(
          `products/${product_id}/${folder}`,
          { resource_type: "video" }
        );

        await model.product_images.destroy({
          where: { product_id, color },
          transaction: t,
        });

        for (const file of files) {
          const up = await cloudinary.uploader.upload(file.path, {
            folder: `products/${product_id}/${folder}`,
            resource_type: "auto",
          });

          await model.product_images.create(
            { product_id, color, image: up.secure_url },
            { transaction: t }
          );
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

    await product.save({ transaction: t });

    await t.commit();
    await cleanupAllTempFiles();

    return res.status(200).json({
      message: "Cập nhật sản phẩm thành công",
    });
  } catch (err) {
    await t.rollback();
    await cleanupAllTempFiles();
    console.error("updateFullProduct ERROR:", err);
    return res.status(500).json({
      message: "Lỗi server",
      error: err.message,
    });
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
    const variantCount = await model.product_variants.count({
      where: { product_id },
    });

    const skuIndex = variantCount + 1;

    const sku = buildSKUWithIndex(
      product.category.name,
      product.product_id,
      colorTrimmed,
      size,
      skuIndex
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
const getNewProductsLast2Days = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // ⏱ Mốc thời gian: 2 ngày trước
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    // 🔢 Đếm tổng
    const total = await model.products.count({
      where: {
        status: "đang bán",
        createdAt: {
          [Op.gte]: twoDaysAgo,
        },
      },
    });

    if (total === 0) {
      return res.status(200).json({
        message: "Không có sản phẩm mới trong 2 ngày gần đây",
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
      where: {
        status: "đang bán",
        createdAt: {
          [Op.gte]: twoDaysAgo,
        },
      },
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

    // 🔄 Format data (GIỮ NGUYÊN LOGIC CŨ)
    const formattedData = products.map((p) => {
      const colors = {};
      p.product_images.forEach((img) => {
        if (!colors[img.color]) {
          colors[img.color] = { color: img.color, images: [] };
        }
        colors[img.color].images.push(img.image);
      });

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
        product_variants: p.product_variants.map((v) => ({
          product_variant_id: v.product_variant_id,
          color: v.color,
          size: v.size,
          stock: v.stock,
          sku: v.sku,
        })),
        colors: Object.values(colors),
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách sản phẩm mới trong 2 ngày gần đây thành công",
      total,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (err) {
    console.error("Lỗi getNewProductsLast2Days:", err);
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
    const { product_id } = req.params;
    if (!product_id) {
      return res.status(400).json({ message: "Chưa cung cấp product_id" });
    }

    const product = await model.products.findByPk(product_id, {
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

    const product = await model.products.findOne({
      where: {
        product_id: product_id,
        status: "đang bán",
      },
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

   
    const inCart = await model.cart_details.count({
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
        },
      });
    }

    const folderPrefix = `products/${product_id}`;

    try {
    
      await cloudinary.api.delete_resources_by_prefix(folderPrefix, {
        resource_type: "image",
      });

     
      await cloudinary.api.delete_resources_by_prefix(folderPrefix, {
        resource_type: "video",
      });

      
      await cloudinary.api.delete_folder(folderPrefix);

      
    } catch (cloudErr) {
      console.error("Lỗi xóa Cloudinary:", cloudErr.message);
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

const getProductByCategory = async (req, res) => {
  try {
    const category_id = parseInt(req.params.category_id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (!category_id) {
      return res
        .status(400)
        .json({ message: "category_id không được để trống" });
    }

    const category = await model.categories.findByPk(category_id, {
      include: [{ model: model.categories, as: "parent" }],
    });

    if (!category) {
      return res.status(404).json({ message: "Danh mục không tồn tại" });
    }

    let level = 3;
    if (category.parent_id === null) {
      level = 1;
    } else if (category.parent && category.parent.parent_id === null) {
      level = 2;
    }

    let categoryIds = [category_id];

    if (level === 1 || level === 2) {
      const allCategories = await model.categories.findAll({
        attributes: ["category_id", "parent_id"],
        raw: true,
      });

      const childIds = getAllChildCategoryIds(allCategories, category_id);
      categoryIds = [...new Set([...childIds, category_id])];
    }

    const total = await model.products.count({
      where: {
        category_id: { [Op.in]: categoryIds },
        status: "đang bán",
      },
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
    const validPage = Math.min(page, totalPages);
    const offset = (validPage - 1) * limit;

    const products = await model.products.findAll({
      where: {
        category_id: { [Op.in]: categoryIds },
        status: "đang bán",
      },
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
        if (!colors[img.color]) {
          colors[img.color] = { color: img.color, images: [] };
        }
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
      message: "Lấy sản phẩm theo danh mục thành công",
      category: {
        category_id: category.category_id,
        name: category.name,
        parent_id: category.parent_id,
        category_level: level,
      },
      total,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (err) {
    console.error("Lỗi getProductByCategory:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

export {
  addFullProduct,
  addProductVariant,
  updateFullProduct,
  addSizeToVariant,
  getAllProducts,
  getActiveProducts,
  getNewProductsLast2Days,
  getProductDetail,
  getProductByKeyWordAdmin,
  getProductByKeyWordUser,
  updateProductStatus,
  getProductsByStatus,
  deleteProduct,
  getProductByCategory,
};
