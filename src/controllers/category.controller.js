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

    if (!name) {
      return res.status(400).json({ message: "Tên danh mục là bắt buộc" });
    }

    // Nếu parent_id được truyền, kiểm tra xem có tồn tại không
    let validParentId = null;
    if (parent_id) {
      const parent = await model.categories.findOne({
        where: { category_id: parent_id },
      });
      if (!parent) {
        return res.status(400).json({ message: "Parent_id không hợp lệ" });
      }
      validParentId = parent_id;
    }

    // Kiểm tra danh mục trùng tên trong cùng cấp
    const existing = await model.categories.findOne({
      where: { name, parent_id: validParentId },
    });

    if (existing) {
      return res
        .status(400)
        .json({ message: "Danh mục đã tồn tại trong cấp này!" });
    }

    // Tạo danh mục mới
    const newCategory = await model.categories.create({
      name,
      parent_id: validParentId, // null nếu là danh mục cha
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
        attributes: ["category_id", "name", "parent_id", "createdAt", "updatedAt"],
        order: [["category_id", "ASC"]],
        raw: true,
      });

      // Tạo map để nhóm children
      const map = {};

      rows.forEach(cat => {
        map[cat.category_id] = {
          category_id: cat.category_id,
          name: cat.name,
          createdAt: formatVNDateTime(cat.createdAt),
        updatedAt: formatVNDateTime(cat.updatedAt),
          children: [],
        };
      });

      const tree = [];

      rows.forEach(cat => {
        if (cat.parent_id === null) {
          // Danh mục gốc
          tree.push(map[cat.category_id]);
        } else {
          // Push vào danh mục cha
          if (map[cat.parent_id]) {
            map[cat.parent_id].children.push(map[cat.category_id]);
          }
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
    const { id } = req.params;
    const { name, parent_id } = req.body;

    const category = await model.categories.findOne({
      where: { category_id: id },
    });
    if (!category) {
      return res.status(404).json({ message: "Danh mục không tồn tại" });
    }

    let validParentId = category.parent_id;

    // Xử lý parent_id nếu người dùng gửi
    if (parent_id !== undefined) {
      // Kiểm tra danh mục có con không
      const childCount = await model.categories.count({
        where: { parent_id: id },
      });
      if (childCount > 0) {
        return res.status(400).json({
          message:
            "Không thể thay đổi parent_id của danh mục đang có danh mục con",
        });
      }

      // Không cho parent_id bằng chính nó
      if (parseInt(parent_id) === parseInt(id)) {
        return res
          .status(400)
          .json({ message: "parent_id không được bằng chính category_id" });
      }

      // Kiểm tra parent_id tồn tại
      if (parent_id) {
        const parent = await model.categories.findOne({
          where: { category_id: parent_id },
        });
        if (!parent) {
          return res.status(400).json({ message: "Parent_id không hợp lệ" });
        }
        validParentId = parent_id;
      } else {
        validParentId = null; // cho phép đặt về root
      }
    }

    // Kiểm tra trùng tên trong cùng cấp
    if (name) {
      const existing = await model.categories.findOne({
        where: {
          name,
          parent_id: validParentId,
          category_id: { [Op.ne]: id },
        },
      });
      if (existing) {
        return res
          .status(400)
          .json({ message: "Danh mục đã tồn tại trong cấp này" });
      }
      category.name = name;
    }

    category.parent_id = validParentId;
    await category.save();

    return res.status(200).json({
      message: "Cập nhật danh mục thành công",
      data: category,
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
    const { id } = req.params;

    const category = await model.categories.findOne({
      where: { category_id: id },
    });
    if (!category) {
      return res.status(404).json({ message: "Danh mục không tồn tại" });
    }

    // Kiểm tra có con
    const childCount = await model.categories.count({
      where: { parent_id: id },
    });
    if (childCount > 0) {
      return res
        .status(400)
        .json({ message: "Không thể xóa danh mục có danh mục con" });
    }

    // Kiểm tra có sản phẩm liên quan
    const productCount = await model.products.count({
      where: { category_id: id },
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

    // Điều kiện tìm kiếm
    const where = keyword
      ? {
          name: { [Op.iLike]: `%${keyword}%` },
        }
      : {};

    // Đếm tổng số bản ghi
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

    // Tính tổng số trang
    const totalPages = Math.ceil(total / pageSize);

    // Ép page không vượt quá totalPages
    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    // Lấy danh sách danh mục
    const rows = await model.categories.findAll({
      where,
      limit: pageSize,
      offset,
      order: [["category_id", "ASC"]],
      raw: true,
    });

    return res.status(200).json({
      message: "Lấy danh sách danh mục thành công",
      data: rows,
      pagination: {
        total,
        page: validPage,
        limit: pageSize,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Lỗi getCategoryByKeyWord:", error);
    return res.status(500).json({ message: "Lỗi server", error });
  }
};
const getCategoryCap1  = async (req, res) => {
  try {
    // Lấy các category cha
    const parentCategories = await model.categories.findAll({
      where: { parent_id: null },
      attributes: ["category_id", "name"],
      order: [["name", "ASC"]], // sắp xếp theo tên
    });

    return res.status(200).json({
      categories: parentCategories,
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
    const { root_id } = req.query;

    if (!root_id) {
      return res.status(400).json({ message: "Nhập thêm root_id" });
    }

    // Kiểm tra root_id tồn tại
    const rootCategory = await model.categories.findByPk(root_id);
    if (!rootCategory) {
      return res.status(404).json({
        message: `id không tồn tại`,
      });
    }

    // Lấy tất cả danh mục có parent_id = root_id hoặc sâu hơn
    // Ở đây giả sử chỉ lấy các danh mục leaf trực tiếp cấp 3
    const leafCategories = await model.categories.findAll({
      where: {
        parent_id: root_id,
      },
      attributes: ["category_id", "name", "parent_id"],
      order: [["name", "ASC"]],
    });

    return res.status(200).json({
      message: "Lấy danh sách danh mục nhỏ nhất thành công",
      data: leafCategories,
    });

  } catch (err) {
    console.error("Lỗi lấy danh mục leaf:", err);
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
