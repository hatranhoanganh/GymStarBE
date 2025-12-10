import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime } from "../utils/dateFormat.js";
import { Op } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const createCategory = async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    const cleanName = name.trim();
    if (!cleanName) {
      return res
        .status(400)
        .json({ message: "Tên danh mục không được để trống" });
    }

    if (!/^[a-zA-ZÀ-ỹ\s]+$/u.test(cleanName)) {
      return res.status(400).json({
        message:
          "Tên danh mục chỉ được chứa chữ cái và khoảng trắng, không được chứa số hoặc ký tự đặc biệt",
      });
    }

    let validParentId = null;
    if (parent_id) {
      const parent = await model.categories.findOne({
        where: { category_id: parent_id },
      });
      if (!parent) {
        return res.status(400).json({ message: "Danh mục cha không hợp lệ" });
      }
      validParentId = parent_id;
    }

    const existing = await model.categories.findOne({
      where: { name: cleanName, parent_id: validParentId },
    });

    if (existing) {
      return res
        .status(400)
        .json({ message: "Tên danh mục đã tồn tại trong cấp này!" });
    }

    const newCategory = await model.categories.create({
      name: cleanName,
      parent_id: validParentId,
      
    });

    return res.status(201).json({
      message: "Thêm danh mục thành công",
      data: newCategory,
    });
  } catch (error) {
    console.error("Lỗi createCategory:", error);
    return res.status(500).json({ message: "Lỗi server khi thêm danh mục" });
  }
};

const getAllCategories = async (req, res) => {
  try {
    const rows = await model.categories.findAll({
      attributes: [
        "category_id",
        "name",
        "parent_id",
        "createdAt",
        "updatedAt",
      ],
      order: [["category_id", "ASC"]],
      raw: true,
    });

    if (rows.length === 0) {
      return res.status(200).json({
        message: "Không có danh mục nào.",
        data: [],
      });
    }

    // Format từng category trước
    const formattedCategories = rows.map((cat) => ({
      category_id: cat.category_id,
      name: cat.name,
      parent_id: cat.parent_id,
      createdAt: formatVNDateTime(cat.createdAt),
      updatedAt: formatVNDateTime(cat.updatedAt),
      children: [],
    }));

    // Tạo map để gắn children
    const map = {};
    formattedCategories.forEach((cat) => {
      map[cat.category_id] = cat;
    });

    const tree = [];
    formattedCategories.forEach((cat) => {
      if (cat.parent_id === null) {
        tree.push(cat);
      } else if (map[cat.parent_id]) {
        map[cat.parent_id].children.push(cat);
      }
    });

    return res.status(200).json({
      message: "Lấy danh mục dạng cây thành công",
      data: tree,
    });
  } catch (error) {
    console.error("Lỗi getAllCategories:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const updateCategory = async (req, res) => {
  try {
    const { category_id } = req.params;
    const { name, parent_id } = req.body;

    const category = await model.categories.findOne({
      where: { category_id },
    });

    if (!category) {
      return res.status(404).json({ message: "Danh mục không tồn tại" });
    }

    let validParentId = category.parent_id;

    if (parent_id !== undefined) {
      if (parseInt(parent_id) === parseInt(category_id)) {
        return res
          .status(400)
          .json({ message: "Danh mục cha không được bằng chính danh mục con" });
      }

      const childCount = await model.categories.count({
        where: { parent_id: category_id },
      });
      if (childCount > 0 && parent_id !== null) {
        return res.status(400).json({
          message: "Không thể thay đổi danh mục cha đang có danh mục con",
        });
      }

      if (parent_id) {
        const parent = await model.categories.findOne({
          where: { category_id: parent_id },
        });
        if (!parent) {
          return res.status(400).json({ message: "Danh mục cha không hợp lệ" });
        }
        validParentId = parent_id;
      } else {
        validParentId = null;
      }
    }

    if (name !== undefined) {
      const cleanName = name?.toString().trim();

      if (!cleanName) {
        return res.status(400).json({
          message: "Tên danh mục không được để trống",
        });
      }

      if (!/^[a-zA-ZÀ-ỹ\s]+$/u.test(cleanName)) {
        return res.status(400).json({
          message:
            "Tên danh mục chỉ được chứa chữ cái và khoảng trắng, không được chứa số hoặc ký tự đặc biệt",
        });
      }

      const existing = await model.categories.findOne({
        where: {
          name: cleanName,
          parent_id: validParentId,
          category_id: { [Op.ne]: category_id },
        },
      });

      if (existing) {
        return res.status(400).json({
          message: "Tên danh mục đã tồn tại trong cấp này",
        });
      }

      category.name = cleanName;
    }
    category.parent_id = validParentId;
    await category.save();

    const formattedCategory = {
      category_id: category.category_id,
      name: category.name,
      parent_id: category.parent_id,
      createdAt: formatVNDateTime(category.createdAt),
      updatedAt: formatVNDateTime(category.updatedAt),
    };

    return res.status(200).json({
      message: "Cập nhật danh mục thành công",
      data: formattedCategory,
    });
  } catch (error) {
    console.error("Lỗi updateCategory:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server khi cập nhật danh mục" });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { category_id } = req.params;

    const category = await model.categories.findOne({
      where: { category_id: category_id },
    });
    if (!category) {
      return res.status(404).json({ message: "Danh mục không tồn tại" });
    }

    const childCount = await model.categories.count({
      where: { parent_id: category_id },
    });
    if (childCount > 0) {
      return res
        .status(400)
        .json({ message: "Không thể xóa danh mục có danh mục con" });
    }

    const productCount = await model.products.count({
      where: { category_id: category_id },
    });
    if (productCount > 0) {
      return res
        .status(400)
        .json({ message: "Không thể xóa danh mục đang có sản phẩm" });
    }

    await category.destroy();

    return res.status(200).json({ message: "Xóa danh mục thành công" });
  } catch (error) {
    console.error("Lỗi deleteCategory:", error);
    return res.status(500).json({ message: "Lỗi server khi xóa danh mục" });
  }
};

const getCategoryByKeyWord = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const where = keyword
      ? {
          name: { [Op.iLike]: `%${keyword}%` },
        }
      : {};

    const total = await model.categories.count({ where });

    if (total === 0) {
      return res.status(200).json({
        message: "Không tìm thấy danh mục nào",
        data: [],
        pagination: {
          total: 0,
          page: 1,
          limit: pageSize,
          totalPages: 0,
        },
      });
    }

    const totalPages = Math.ceil(total / pageSize);

    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    const rows = await model.categories.findAll({
      where,
      limit: pageSize,
      offset,
      order: [["category_id", "ASC"]],
    });

    const formattedData = rows.map((cat) => ({
      category_id: cat.category_id,
      name: cat.name,
      parent_id: cat.parent_id,
      createdAt: formatVNDateTime(cat.createdAt),
      updatedAt: formatVNDateTime(cat.updatedAt),
    }));

    return res.status(200).json({
      message: "Lấy danh sách danh mục thành công",
      data: formattedData,
      pagination: {
        total,
        page: validPage,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Lỗi getCategoryByKeyWord:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const getCategoryCap1 = async (req, res) => {
  try {
    const parentCategories = await model.categories.findAll({
      where: { parent_id: null },
      attributes: ["category_id", "name", "createdAt", "updatedAt"],
      order: [["name", "ASC"]],
    });

    const formattedCategories = parentCategories.map((cat) => ({
      category_id: cat.category_id,
      name: cat.name,
      createdAt: formatVNDateTime(cat.createdAt),
      updatedAt: formatVNDateTime(cat.updatedAt),
    }));

    return res.status(200).json({
      message: "Lấy danh mục cấp 1 thành công",
      data: formattedCategories,
    });
  } catch (err) {
    console.error("Lỗi lấy danh mục cấp 1:", err);
    return res.status(500).json({
      message: "Lỗi server",
      error: err.message,
    });
  }
};

const getCategoryCap3LocCap1 = async (req, res) => {
  try {
    const { root_id } = req.params;

    if (!root_id) {
      return res.status(400).json({ message: "Nhập thêm root_id" });
    }

    const rootCategory = await model.categories.findByPk(root_id);
    if (!rootCategory) {
      return res.status(404).json({ message: "Root_id không tồn tại" });
    }

    const level2Categories = await model.categories.findAll({
      where: { parent_id: root_id },
      attributes: ["category_id", "name"],
    });

    if (level2Categories.length === 0) {
      return res.status(200).json({
        message: "Không có danh mục cấp 3 dưới root này",
        data: [],
      });
    }

    const level2Ids = level2Categories.map((cat) => cat.category_id);

    const level3Categories = await model.categories.findAll({
      where: { parent_id: level2Ids },
      attributes: [
        "category_id",
        "name",
        "parent_id",
        "createdAt",
        "updatedAt",
      ],
      order: [["name", "ASC"]],
      raw: true,
    });

    const formattedData = level3Categories.map((cat) => {
      const parent = level2Categories.find(
        (p) => p.category_id === cat.parent_id
      );
      return {
        category_id: cat.category_id,
        name: cat.name,
        parent_id: cat.parent_id,
        parent_name: parent ? parent.name : null,
        root_name: rootCategory.name,
        createdAt: formatVNDateTime(cat.createdAt),
        updatedAt: formatVNDateTime(cat.updatedAt),
      };
    });

    return res.status(200).json({
      message: "Lấy danh sách danh mục cấp 3 thành công",
      data: formattedData,
    });
  } catch (err) {
    console.error("Lỗi lấy danh mục cấp 3:", err);
    return res.status(500).json({ message: "Lỗi server", error: err.message });
  }
};

export {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getCategoryByKeyWord,
  getCategoryCap1,
  getCategoryCap3LocCap1,
};
