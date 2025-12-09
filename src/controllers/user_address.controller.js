import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { formatVNDateTime, formatVNDate } from "../utils/dateFormat.js";
import { Op, literal } from "sequelize";

dotenv.config();
const model = initModels(sequelize);

const addAddress = async (req, res) => {
  try {
    const { user_id, receiver_name, phone, address_detail } = req.body;

    const trimmedUserId = user_id?.toString().trim();
    const trimmedReceiver = receiver_name?.trim();
    const trimmedPhone = phone?.trim();
    const trimmedAddress = address_detail?.trim();

    if (
      !trimmedUserId ||
      !trimmedReceiver ||
      !trimmedPhone ||
      !trimmedAddress
    ) {
      return res
        .status(400)
        .json({ message: "Các trường không được để trống" });
    }

    const nameRegex = /^[A-Za-zÀ-ỹ\s]+$/;
    if (!nameRegex.test(trimmedReceiver)) {
      return res.status(400).json({
        message: "Tên người nhận chỉ được chứa chữ cái và khoảng trắng",
      });
    }
    if (trimmedReceiver.length < 2 || trimmedReceiver.length > 100) {
      return res
        .status(400)
        .json({ message: "Tên người nhận phải từ 2 đến 100 ký tự" });
    }

    // Validation phone
    const phoneRegex = /^0\d{9}$/;
    if (!phoneRegex.test(trimmedPhone)) {
      return res.status(400).json({
        message: "Số điện thoại phải bắt đầu bằng 0 và gồm 10 chữ số",
      });
    }

    const addressRegex = /^[A-Za-zÀ-ỹ0-9\s\/,]+$/;
    if (!addressRegex.test(trimmedAddress)) {
      return res.status(400).json({
        message: "Địa chỉ giao hàng chỉ được chứa chữ, số, dấu '/' và ','",
      });
    }
    const hasLetter = /[A-Za-zÀ-ỹ]/.test(trimmedAddress);
    const hasNumber = /[0-9]/.test(trimmedAddress);
    if (!hasLetter || !hasNumber) {
      return res
        .status(400)
        .json({ message: "Địa chỉ giao hàng phải chứa cả chữ và số" });
    }
    if (trimmedAddress.length < 10 || trimmedAddress.length > 255) {
      return res
        .status(400)
        .json({ message: "Địa chỉ giao hàng phải từ 10 đến 255 ký tự" });
    }

    const user = await model.users.findByPk(trimmedUserId, {
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

    const addressCount = await model.user_addresses.count({
      where: { user_id: trimmedUserId },
    });
    if (addressCount >= 10) {
      return res
        .status(400)
        .json({ message: "Người dùng đã có 10 địa chỉ, không thể thêm nữa" });
    }

    await model.user_addresses.update(
      { is_default: false },
      { where: { user_id: trimmedUserId } }
    );

    const newAddress = await model.user_addresses.create({
      user_id: trimmedUserId,
      receiver_name: trimmedReceiver,
      phone: trimmedPhone,
      address_detail: trimmedAddress,
      is_default: true,
    });

    const formattedAddress = {
      address_id: newAddress.address_id,
      receiver_name: newAddress.receiver_name,
      phone: newAddress.phone,
      address_detail: newAddress.address_detail,
      is_default: newAddress.is_default,
    };

    const formattedUser = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      gender: user.gender,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      status: user.status,
      role_id: user.role?.role_id || null,
      role_name: user.role?.role_name || null,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    };

    return res.status(201).json({
      message: "Thêm địa chỉ thành công",
      data: { user: formattedUser, address: formattedAddress },
    });
  } catch (error) {
    console.error("Lỗi addAddress:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const updateAddress = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { address_id, receiver_name, phone, address_detail } = req.body;

    if (!user_id || !address_id) {
      return res.status(400).json({ message: "Thiếu user_id hoặc address_id" });
    }

    const user = await model.users.findByPk(user_id, {
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

    const address = await model.user_addresses.findOne({
      where: { user_id, address_id },
    });
    if (!address)
      return res.status(404).json({ message: "Địa chỉ không tồn tại" });

    const trimmedReceiver = receiver_name?.trim();
    const trimmedPhone = phone?.trim();
    const trimmedAddress = address_detail?.trim();

    if (trimmedReceiver !== undefined) {
      if (!trimmedReceiver)
        return res
          .status(400)
          .json({ message: "Tên người nhận không được để trống" });
      const nameRegex = /^[A-Za-zÀ-ỹ\s]+$/;
      if (!nameRegex.test(trimmedReceiver))
        return res.status(400).json({
          message: "Tên người nhận chỉ được chứa chữ cái và khoảng trắng",
        });
      if (trimmedReceiver.length < 2 || trimmedReceiver.length > 100)
        return res
          .status(400)
          .json({ message: "Tên người nhận phải từ 2 đến 100 ký tự" });
      address.receiver_name = trimmedReceiver;
    }

    if (trimmedPhone !== undefined) {
      if (!trimmedPhone)
        return res
          .status(400)
          .json({ message: "Số điện thoại không được để trống" });
      const phoneRegex = /^0\d{9}$/;
      if (!phoneRegex.test(trimmedPhone))
        return res.status(400).json({
          message: "Số điện thoại phải bắt đầu bằng 0 và gồm 10 chữ số",
        });
      address.phone = trimmedPhone;
    }

    if (trimmedAddress !== undefined) {
      if (!trimmedAddress)
        return res
          .status(400)
          .json({ message: "Địa chỉ giao hàng không được để trống" });
      const addressRegex = /^[A-Za-zÀ-ỹ0-9\s\/,]+$/;
      if (!addressRegex.test(trimmedAddress))
        return res.status(400).json({
          message: "Địa chỉ giao hàng chỉ được chứa chữ, số, dấu '/' và ','",
        });
      const hasLetter = /[A-Za-zÀ-ỹ]/.test(trimmedAddress);
      const hasNumber = /[0-9]/.test(trimmedAddress);
      if (!hasLetter || !hasNumber)
        return res
          .status(400)
          .json({ message: "Địa chỉ giao hàng phải chứa cả chữ và số" });
      if (trimmedAddress.length < 10 || trimmedAddress.length > 255)
        return res
          .status(400)
          .json({ message: "Địa chỉ giao hàng phải từ 10 đến 255 ký tự" });
      address.address_detail = trimmedAddress;
    }

    await address.save();

    const formattedAddress = {
      address_id: address.address_id,
      receiver_name: address.receiver_name,
      phone: address.phone,
      address_detail: address.address_detail,
      is_default: address.is_default,
    };

    const formattedUser = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      gender: user.gender,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      status: user.status,
      role_id: user.role?.role_id || null,
      role_name: user.role?.role_name || null,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    };

    return res.status(200).json({
      message: "Cập nhật địa chỉ thành công",
      data: { user: formattedUser, address: formattedAddress },
    });
  } catch (error) {
    console.error("Lỗi updateAddress:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const deleteAddress = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { address_id } = req.body;

    if (!user_id || !address_id) {
      return res.status(400).json({ message: "Thiếu user_id hoặc address_id" });
    }

    const user = await model.users.findByPk(user_id, {
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

    const address = await model.user_addresses.findOne({
      where: { user_id, address_id },
    });
    if (!address)
      return res.status(404).json({ message: "Địa chỉ không tồn tại" });

    if (address.is_default) {
      return res
        .status(400)
        .json({ message: "Không được xóa địa chỉ mặc định" });
    }

    const deletedAddress = {
      address_id: address.address_id,
      receiver_name: address.receiver_name,
      phone: address.phone,
      address_detail: address.address_detail,
      is_default: address.is_default,
    };

    await address.destroy();

    const formattedUser = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      gender: user.gender,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      status: user.status,
      role_id: user.role?.role_id || null,
      role_name: user.role?.role_name || null,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    };

    return res.status(200).json({
      message: "Xóa địa chỉ thành công",
      data: {
        user: formattedUser,
        deletedAddress,
      },
    });
  } catch (error) {
    console.error("Lỗi deleteAddress:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const setDefaultAddress = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { address_id } = req.body;

    if (!user_id || !address_id) {
      return res.status(400).json({ message: "Thiếu user_id hoặc address_id" });
    }

    const user = await model.users.findByPk(user_id, {
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

    const address = await model.user_addresses.findOne({
      where: { user_id, address_id },
    });
    if (!address)
      return res.status(404).json({ message: "Địa chỉ không tồn tại" });

    if (address.is_default) {
      return res.status(400).json({ message: "Địa chỉ này đã là mặc định" });
    }

    await model.user_addresses.update(
      { is_default: false },
      { where: { user_id } }
    );

    address.is_default = true;
    await address.save();

    const formattedAddress = {
      address_id: address.address_id,
      receiver_name: address.receiver_name,
      phone: address.phone,
      address_detail: address.address_detail,
      is_default: address.is_default,
    };

    const formattedUser = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      gender: user.gender,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      status: user.status,
      role_id: user.role?.role_id || null,
      role_name: user.role?.role_name || null,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    };

    return res.status(200).json({
      message: "Đặt địa chỉ mặc định thành công",
      data: {
        user: formattedUser,
        address: formattedAddress,
      },
    });
  } catch (error) {
    console.error("Lỗi setDefaultAddress:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

const getAllUserAddresses = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const count = await model.users.count({
      include: [
        {
          model: model.user_addresses,
          as: "user_addresses",
          required: true,
        },
      ],
    });

    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Không có dữ liệu địa chỉ nào.",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    const users = await model.users.findAll({
      attributes: [
        "user_id",
        "full_name",
        "email",
        "gender",
        "birth_date",
        "status",
        "role_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
        {
          model: model.user_addresses,
          as: "user_addresses",
          attributes: [
            "address_id",
            "receiver_name",
            "phone",
            "address_detail",
            "is_default",
          ],
          required: true,
        },
      ],
      limit: pageSize,
      offset,
      order: [["user_id", "ASC"]],
    });

    const formattedData = users.map((u) => ({
      user: {
        user_id: u.user_id,
        full_name: u.full_name,
        email: u.email,
        gender: u.gender,
        birth_date: u.birth_date ? formatVNDate(u.birth_date) : null,
        status: u.status,
        role_id: u.role?.role_id || null,
        role_name: u.role?.role_name || null,
        createdAt: formatVNDateTime(u.createdAt),
        updatedAt: formatVNDateTime(u.updatedAt),
      },
      addresses: u.user_addresses.map((addr) => ({
        address_id: addr.address_id,
        receiver_name: addr.receiver_name,
        phone: addr.phone,
        address_detail: addr.address_detail,
        is_default: addr.is_default,
      })),
    }));

    return res.status(200).json({
      message: "Lấy danh sách địa chỉ theo user thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getAllUserAddressesGrouped:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
const getUserAddressesById = async (req, res) => {
  try {
    const { user_id } = req.params;

    if (!user_id) {
      return res.status(400).json({ message: "Thiếu user_id" });
    }

    const user = await model.users.findByPk(user_id, {
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
        {
          model: model.user_addresses,
          as: "user_addresses",
          attributes: [
            "address_id",
            "receiver_name",
            "phone",
            "address_detail",
            "is_default",
          ],
        },
      ],
    });

    if (!user)
      return res.status(404).json({ message: "Người dùng không tồn tại" });

    const formattedUser = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      gender: user.gender,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      status: user.status,
      role_id: user.role?.role_id || null,
      role_name: user.role?.role_name || null,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    };

    const formattedAddresses = user.user_addresses.map((addr) => ({
      address_id: addr.address_id,
      receiver_name: addr.receiver_name,
      phone: addr.phone,
      address_detail: addr.address_detail,
      is_default: addr.is_default,
    }));

    return res.status(200).json({
      message: "Lấy danh sách địa chỉ thành công",
      data: {
        user: formattedUser,
        addresses: formattedAddresses,
      },
    });
  } catch (error) {
    console.error("Lỗi getUserAddresses:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};
function removeVietnameseTones(str) {
  if (!str) return "";
  str = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  str = str.replace(/đ/g, "d").replace(/Đ/g, "D");
  return str;
}
const getUserAddressesByKeyWord = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;

    const users = await model.users.findAll({
      attributes: [
        "user_id",
        "full_name",
        "email",
        "gender",
        "birth_date",
        "status",
        "role_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
        {
          model: model.user_addresses,
          as: "user_addresses",
          attributes: [
            "address_id",
            "receiver_name",
            "phone",
            "address_detail",
            "is_default",
          ],
        },
      ],
      order: [["user_id", "ASC"]],
    });

    const normalizedKeyword = removeVietnameseTones(keyword).toLowerCase();

    const filteredData = users
      .map((user) => {
        const matchedAddresses = user.user_addresses.filter(
          (addr) =>
            removeVietnameseTones(addr.receiver_name)
              .toLowerCase()
              .includes(normalizedKeyword) ||
            removeVietnameseTones(addr.address_detail)
              .toLowerCase()
              .includes(normalizedKeyword) ||
            addr.phone.includes(keyword.trim())
        );
        if (matchedAddresses.length > 0) {
          return {
            user: {
              user_id: user.user_id,
              full_name: user.full_name,
              email: user.email,
              gender: user.gender,
              birth_date: user.birth_date
                ? formatVNDate(user.birth_date)
                : null,
              status: user.status,
              role_id: user.role?.role_id || null,
              role_name: user.role?.role_name || null,
              createdAt: formatVNDateTime(user.createdAt),
              updatedAt: formatVNDateTime(user.updatedAt),
            },
            addresses: matchedAddresses.map((addr) => ({
              address_id: addr.address_id,
              receiver_name: addr.receiver_name,
              phone: addr.phone,
              address_detail: addr.address_detail,
              is_default: addr.is_default,
            })),
          };
        }
        return null;
      })
      .filter(Boolean);

    if (filteredData.length === 0) {
      return res.status(200).json({
        message: "Không tìm thấy địa chỉ phù hợp",
        total: 0,
        page: 1,
        totalPages: 0,
        data: [],
      });
    }

    const total = filteredData.length;
    const totalPages = Math.ceil(total / pageSize);
    const validPage = Math.min(pageNum, totalPages);
    const offset = (validPage - 1) * pageSize;
    const pagedData = filteredData.slice(offset, offset + pageSize);

    return res.status(200).json({
      message: "Tìm kiếm địa chỉ thành công",
      total,
      page: validPage,
      totalPages,
      data: pagedData,
    });
  } catch (error) {
    console.error("Lỗi searchUserAddressesGrouped:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server", error: error.message });
  }
};

export {
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  getAllUserAddresses,
  getUserAddressesById,
  getUserAddressesByKeyWord,
};
