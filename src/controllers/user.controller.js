import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import {
  sendVerificationEmail,
  sendConfirmationEmail,
  sendOTPEmail,
} from "../config/email.js";
import { formatVNDateTime, formatVNDate } from "../utils/dateFormat.js";
import { redis, connectRedis } from "../config/redis.js";

dotenv.config();
const model = initModels(sequelize);

/** ============ ĐĂNG KÝ NGƯỜI DÙNG ============ */
const registerUser = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;

    // === BƯỚC 1: TRIM & VALIDATION CƠ BẢN ===
    const trimmedFullName = full_name?.trim();
    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedPassword = password?.trim();

    if (!trimmedFullName || !trimmedEmail || !trimmedPassword) {
      return res.status(400).json({
        message: "Vui lòng nhập đầy đủ họ tên, email và mật khẩu",
      });
    }

    // Họ tên
    if (trimmedFullName.length < 3 || trimmedFullName.length > 100) {
      return res.status(400).json({ message: "Họ tên phải từ 3–100 ký tự" });
    }
    const nameRegex = /^[\p{L} ]{2,100}$/u;
    if (!nameRegex.test(trimmedFullName)) {
      return res.status(400).json({
        message: "Họ tên chỉ được chứa chữ cái và khoảng trắng",
      });
    }

    // Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({
        message: "Email không hợp lệ. Ví dụ hợp lệ: abc@example.com",
      });
    }

    // Mật khẩu
    if (trimmedPassword.length < 8) {
      return res.status(400).json({ message: "Mật khẩu phải ít nhất 8 ký tự" });
    }

    // === BƯỚC 2: CHỐNG SPAM – 15 PHÚT / 1 LẦN (có countdown từng giây) ===
    const COOLDOWN_KEY = `register_cooldown:${trimmedEmail}`;
    const COOLDOWN_SECONDS = 2 * 60; // ← Đổi lại thành 15 phút (trong code bạn để 2 phút)

    const setResult = await redis.set(COOLDOWN_KEY, "1", {
      NX: true,
      EX: COOLDOWN_SECONDS,
    });

    if (!setResult) {
      let ttl = await redis.ttl(COOLDOWN_KEY);
      if (ttl <= 0) ttl = 1;

      return res.status(429).json({
        success: false,
        message: "Bạn đã gửi yêu cầu đăng ký quá nhanh!",
        hint: `Vui lòng đợi ${ttl} giây trước khi thử lại.`,
        retryAfter: ttl,     // ← Frontend dùng để đếm ngược từng giây
        cooldown: true
      });
    }

    // === BƯỚC 3: KIỂM TRA USER ĐÃ TỒN TẠI CHƯA ===
    const existingUser = await model.users.findOne({
      where: { email: { [Op.iLike]: trimmedEmail } },
    });

    if (existingUser) {
      // 1. ĐÃ XÁC NHẬN → không cho đăng ký lại
      if (existingUser.status === "đang hoạt động") {
        await redis.del(COOLDOWN_KEY);
        return res.status(400).json({
          message: "Email này đã được sử dụng. Vui lòng chọn email khác.",
        });
      }

      // 2. BỊ CẤM
      if (existingUser.status === "bị cấm") {
        await redis.del(COOLDOWN_KEY);
        return res.status(400).json({
          message: "Tài khoản liên kết với email này đã bị khóa.",
        });
      }

      // 3. CHƯA XÁC NHẬN → GỬI LẠI EMAIL XÁC NHẬN NGAY LẬP TỨC (UX SIÊU MƯỢT)
      if (existingUser.status === "chưa xác nhận") {
        const newToken = jwt.sign(
          { user_id: existingUser.user_id, email: existingUser.email },
          process.env.ACCESS_TOKEN_SECRET,
          { expiresIn: "2m" }
        );

        await sendVerificationEmail(existingUser.email, newToken);

        // Format dữ liệu trả về giống như đăng ký mới
        const userWithRole = await model.users.findOne({
          where: { user_id: existingUser.user_id },
          include: [{ model: model.roles, as: "role", attributes: ["role_name"] }],
        });

        const { role, ...rest } = userWithRole.toJSON();
        const formattedUser = {
          user_id: rest.user_id,
          full_name: rest.full_name,
          email: rest.email,
          gender: rest.gender,
          birth_date: rest.birth_date ? formatVNDate(rest.birth_date) : null,
          status: rest.status,
          role_name: role?.role_name || null,
        };

        return res.status(200).json({
          success: true,
          message: "Chúng tôi vừa gửi lại email xác nhận đến bạn!",
          hint: "Vui lòng kiểm tra hộp thư (bao gồm Spam/Junk). Link có hiệu lực 2 phút.",
          data: formattedUser,
          resend: true  // Frontend có thể hiện toast thành công
        });
      }
    }

    // === BƯỚC 4: TẠO USER MỚI ===
    const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

    const newUser = await model.users.create({
      full_name: trimmedFullName,
      email: trimmedEmail,
      password: hashedPassword,
      role_id: 1,
      status: "chưa xác nhận",
    });

    // === BƯỚC 5: FORMAT USER TRẢ VỀ ===
    const userWithRole = await model.users.findOne({
      where: { user_id: newUser.user_id },
      include: [{ model: model.roles, as: "role", attributes: ["role_name"] }],
    });

    const { role, ...rest } = userWithRole.toJSON();
    const formattedUser = {
      user_id: rest.user_id,
      full_name: rest.full_name,
      email: rest.email,
      gender: rest.gender,
      birth_date: rest.birth_date ? formatVNDate(rest.birth_date) : null,
      status: rest.status,
      role_name: role?.role_name || null,
    };

    // === BƯỚC 6: GỬI EMAIL XÁC NHẬN ===
    const verificationToken = jwt.sign(
      { user_id: newUser.user_id, email: newUser.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "2m" }
    );

    await sendVerificationEmail(newUser.email, verificationToken);

    // === BƯỚC 7: TRẢ KẾT QUẢ THÀNH CÔNG ===
    return res.status(201).json({
      success: true,
      message: "Đăng ký thành công! Vui lòng kiểm tra hộp thư (bao gồm Spam/Junk) để xác nhận tài khoản. Link có hiệu lực 2 phút.",
      data: formattedUser,
    });

  } catch (error) {
    console.error("Lỗi đăng ký:", error);

    // Xóa cooldown nếu có lỗi → tránh treo người dùng oan
    if (req.body.email) {
      const email = req.body.email?.trim().toLowerCase();
      if (email) {
        await redis.del(`register_cooldown:${email}`).catch(() => {});
      }
    }

    return res.status(500).json({
      success: false,
      message: "Đã có lỗi xảy ra. Vui lòng thử lại sau vài phút.",
    });
  }
};

const verifyEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
        <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#fff5f5;">
          <h3 style="color:#e53e3e;">Thiếu mã xác nhận</h3>
          <p>Vui lòng kiểm tra link trong email.</p>
        </div>
      `);
  }

  let decoded;

  try {
    // BƯỚC 1: GIẢI MÃ TOKEN ĐỂ LẤY user_id (DÙ HẾT HẠN)
    decoded = jwt.decode(token);
    if (!decoded?.user_id) {
      return res.status(400).send(`
          <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#fff5f5;">
            <h3 style="color:#e53e3e;">Link xác nhận không hợp lệ</h3>
            <p>Token bị lỗi hoặc đã bị sửa đổi.</p>
          </div>
        `);
    }

    // BƯỚC 2: TÌM NGƯỜI DÙNG TRƯỚC
    const user = await model.users.findByPk(decoded.user_id);
    if (!user) {
      return res.status(400).send(`
          <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#fff5f5;">
            <h3 style="color:#e53e3e;">Mã xác nhận không hợp lệ</h3>
            <p>Người dùng không tồn tại trong hệ thống.</p>
          </div>
        `);
    }

    // BƯỚC 3: ƯU TIÊN 1 – ĐÃ XÁC NHẬN RỒI
    if (user.status === "đang hoạt động") {
      return res.send(`
          <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#f0fff4;">
            <h3 style="color:#48bb78;">Tài khoản đã được xác nhận</h3>
            <p>Bạn có thể đăng nhập ngay bây giờ.</p>
            <a href="${process.env.CLIENT_URL || "http://localhost:5173"}/login"
              style="background:#48bb78; color:white; padding:14px 28px; text-decoration:none; border-radius:8px; font-weight:bold; margin-top:20px; display:inline-block;">
              Đăng nhập ngay
            </a>
          </div>
        `);
    }

    // BƯỚC 4: KIỂM TRA TOKEN CÒN HẠN KHÔNG
    try {
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET); // Nếu OK → vào đây

      // TOKEN CÒN HẠN → XÁC NHẬN NGAY
      await user.update({ status: "đang hoạt động" });
      await sendConfirmationEmail(user.email, user.full_name);

      return res.send(`
          <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#f0fff4; min-height:100vh;">
            <div style="background:white; padding:40px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); max-width:500px; margin:0 auto;">
              <h2 style="color:#48bb78; margin-bottom:16px;">Xác nhận thành công!</h2>
              <p style="font-size:16px; color:#2d3748;">Chào mừng <strong>${
                user.full_name
              }</strong>!</p>
              <p style="color:#718096; margin:20px 0;">Tài khoản đã được kích hoạt.</p>
              <a href="${
                process.env.CLIENT_URL || "http://localhost:5173"
              }/login"
                style="display:inline-block; background:#48bb78; color:white; padding:14px 28px; text-decoration:none; border-radius:8px; font-weight:bold; margin-top:20px;">
                Đăng nhập ngay
              </a>
            </div>
          </div>
        `);
    } catch (verifyErr) {
      // CHỈ VÀO ĐÂY NẾU TOKEN HẾT HẠN
      if (verifyErr.name === "TokenExpiredError") {
        // TỰ ĐỘNG GỬI LẠI EMAIL MỚI
        const newToken = jwt.sign(
          { user_id: user.user_id, email: user.email },
          process.env.ACCESS_TOKEN_SECRET,
          { expiresIn: "2m" }
        );

        await sendVerificationEmail(user.email, newToken);

        return res.send(`
            <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#fef5e7; min-height:100vh;">
              <div style="background:white; padding:40px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); max-width:500px; margin:0 auto;">
                <h2 style="color:#f56565; margin-bottom:16px;">Mã xác nhận đã hết hạn</h2>
                <p style="font-size:16px; color:#2d3748;">
                  Không sao! Chúng tôi đã <strong>gửi mã xác nhận mới</strong> đến:
                </p>
                <h3 style="color:#48bb78; margin:16px 0; font-size:18px;">${
                  user.email
                }</h3>
                <p style="color:#718096;">
                  Vui lòng kiểm tra <strong>hộp thư đến</strong> và <strong>mục Spam/Junk</strong>.<br>
                  Link mới có hiệu lực trong <strong>2 phút</strong>.
                </p>  
                <p style="margin-top:24px; font-size:14px; color:#a0aec0;">
                  <em>Thời gian hiện tại: ${new Date().toLocaleString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                  })}</em>
                </p>
              </div>
            </div>
          `);
      }

      // Token bị sửa đổi → Không phải hết hạn
      return res.status(400).send(`
          <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#fff5f5;">
            <h3 style="color:#e53e3e;">Mã xác nhận không hợp lệ</h3>
            <p>Vui lòng sử dụng link trong email mới nhất.</p>
          </div>
        `);
    }
  } catch (err) {
    console.error("Lỗi verifyEmail:", err);
    return res.status(400).send(`
        <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#fff5f5;">
          <h3 style="color:#e53e3e;">Mã xác nhận không hợp lệ</h3>
          <p>Vui lòng thử lại hoặc liên hệ hỗ trợ.</p>
        </div>
      `);
  }
};

/** ============ ĐĂNG NHẬP ============ */
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    // Trim input
    const trimmedEmail = email?.trim().toLowerCase();
    const trimmedPassword = password?.trim();

    // Validate trước khi query DB
    if (!trimmedEmail) {
      return res.status(400).json({ message: "Vui lòng nhập email" });
    }
    if (!trimmedPassword) {
      return res.status(400).json({ message: "Vui lòng nhập mật khẩu" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res
        .status(400)
        .json({
          message:
            "Email không hợp lệ. Vui lòng nhập đúng định dạng (ví dụ: abc@example.com)",
        });
    }

    // Lấy user
    const user = await model.users.findOne({
      where: { email },
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Email hoặc mật khẩu không đúng" });
    }

    // ===== Kiểm tra trạng thái =====
    if (user.status === "chưa xác nhận") {
      return res.status(403).json({
        message:
          "Email này đã được đăng ký nhưng chưa xác nhận. Vui lòng kiểm tra hộp thư (bao gồm Spam/Junk) để xác nhận tài khoản.",
      });
    }

    if (user.status === "bị cấm") {
      return res.status(403).json({
        message: "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.",
      });
    }

    // ===== Check password =====
    const isMatch = await bcrypt.compare(trimmedPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    // ===== Tạo token =====
    const accessToken = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role?.role_id },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    const refreshToken = jwt.sign(
      { user_id: user.user_id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    console.log({
      accessToken,
      refreshToken,
    });

    // ===== FORMAT DATA GIỐNG addProduct =====
    const formatData = {
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
      message: "Đăng nhập thành công",
      user: formatData,
    });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
/** ============ LÀM MỚI TOKEN ============ */
const refreshTokenRoute = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(400).json({ message: "Thiếu refresh token" });

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await model.users.findByPk(decoded.user_id);
    if (!user)
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    if (user.status === "disabled") {
      return res.status(403).json({ message: "Tài khoản đã bị vô hiệu hóa." });
    }

    const newAccessToken = jwt.sign(
      { user_id: user.user_id, email: user.email, role: user.role },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    const newRefreshToken = jwt.sign(
      { user_id: user.user_id },
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      message: "Làm mới token thành công",
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    return res
      .status(401)
      .json({ message: "Refresh token không hợp lệ hoặc đã hết hạn" });
  }
};

/** ============ LẤY DANH SÁCH NGƯỜI DÙNG ============ */

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const count = await model.users.count();
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
      return res.status(200).json({
        message: "Không có dữ liệu người dùng.",
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
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
      limit: pageSize,
      offset,
      order: [["user_id", "ASC"]],
    });

    // ===== Format dữ liệu giống addProduct =====
    const formattedData = users.map((user) => ({
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
    }));

    return res.status(200).json({
      message: "Lấy danh sách người dùng thành công",
      total: count,
      page: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi getAllUsers:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

/** ============ LẤY THÔNG TIN MỘT NGƯỜI DÙNG THEO ID ============ */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "Thiếu user_id" });
    }

    // Lấy user kèm role
    const userData = await model.users.findByPk(id, {
      attributes: [
        "user_id",
        "full_name",
        "email",
        "gender",
        "birth_date",
        "status",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
    });

    if (!userData) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // Format dữ liệu
    const formattedUser = {
      user_id: userData.user_id,
      full_name: userData.full_name,
      email: userData.email,
      gender: userData.gender,
      birth_date: userData.birth_date
        ? formatVNDate(userData.birth_date)
        : null,
      status: userData.status,
      role_id: userData.role?.role_id || null,
      role_name: userData.role?.role_name || null,
      createdAt: formatVNDateTime(userData.createdAt),
      updatedAt: formatVNDateTime(userData.updatedAt),
    };

    return res.status(200).json({
      message: "Lấy thông tin người dùng thành công",
      data: formattedUser,
    });
  } catch (error) {
    console.error("Lỗi getUserById:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await model.users.findByPk(id, {
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ], // join bảng roles
    });

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // Không cho đổi trạng thái nếu chưa xác nhận email
    if (user.status === "chưa xác nhận") {
      return res.status(400).json({
        message: "Không thể thay đổi trạng thái tài khoản chưa xác nhận email",
      });
    }

    let newStatus;
    if (user.status === "đang hoạt động") {
      newStatus = "bị cấm"; 
    } else if (user.status === "bị cấm" || user.status === null) {
      newStatus = "đang hoạt động"; 
    } else {
      return res.status(400).json({
        message: `Không thể thay đổi trạng thái tài khoản với trạng thái hiện tại: ${user.status}`,
      });
    }

    await user.update({ status: newStatus });

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
      message: `Thay đổi trạng thái thành công. Trạng thái mới: ${newStatus}`,
      data: formattedUser,
    });
  } catch (error) {
    console.error("Lỗi toggleUserStatus:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, gender, birth_date } = req.body;

    // 1. Tìm user theo ID kèm role
    const user = await model.users.findByPk(id, {
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ], // join bảng roles
    });

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // 2. Chuẩn bị dữ liệu cập nhật
    const updateData = {};

    // Xử lý full_name
    if (full_name !== undefined) {
      const trimmedName = full_name.trim();
      if (
        trimmedName === "" ||
        trimmedName.length < 2 ||
        trimmedName.length > 100
      ) {
        return res.status(400).json({
          message: "Họ tên phải từ 2–100 ký tự và không được để trống",
        });
      }
      if (!/^[\p{L} ]+$/u.test(trimmedName)) {
        return res.status(400).json({
          message: "Họ tên chỉ được chứa chữ và khoảng trắng",
        });
      }
      updateData.full_name = trimmedName;
    }
    // Xử lý gender
    if (gender !== undefined) {
      if (!["nữ", "nam", null].includes(gender)) {
        return res.status(400).json({ message: "Giới tính không hợp lệ" });
      }
      updateData.gender = gender;
    }

    // Xử lý birth_date
    if (birth_date !== undefined) {
      const trimmed = birth_date?.trim();

      if (!trimmed || trimmed === "") {
        updateData.birth_date = null; // Xóa ngày sinh
      } else {
        // Kiểm tra định dạng DD-MM-YYYY
        if (!/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
          return res
            .status(400)
            .json({ message: "Ngày sinh phải định dạng DD-MM-YYYY" });
        }

        const [day, month, year] = trimmed.split("-").map(Number);
        const currentYear = new Date().getFullYear();

        // Kiểm tra giá trị cơ bản
        if (
          day < 1 ||
          day > 31 ||
          month < 1 ||
          month > 12 ||
          year < 1900 ||
          year > currentYear
        ) {
          return res.status(400).json({
            message: `Ngày/tháng/năm không hợp lệ (năm ≤ ${currentYear})`,
          });
        }

        // Kiểm tra ngày thực sự tồn tại
        const dateObj = new Date(year, month - 1, day);
        if (
          dateObj.getFullYear() !== year ||
          dateObj.getMonth() !== month - 1 ||
          dateObj.getDate() !== day
        ) {
          return res.status(400).json({ message: "Ngày sinh không tồn tại " });
        }

        // Giới hạn tuổi hợp lý 5–120
        const age = currentYear - year;
        if (age < 5 || age > 120) {
          return res.status(400).json({
            message: "Ngày sinh không hợp lệ về độ tuổi (5-120 tuổi)",
          });
        }

        // Chuyển sang định dạng YYYY-MM-DD để lưu DB
        updateData.birth_date = `${year}-${String(month).padStart(
          2,
          "0"
        )}-${String(day).padStart(2, "0")}`;
      }
    }

    // Nếu không có gì để cập nhật
    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json({ message: "Không có thông tin nào để cập nhật" });
    }

    // 3. Cập nhật vào DB
    await user.update(updateData);

    // 4. Format dữ liệu trả về
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

    // 5. Trả kết quả
    return res.status(200).json({
      message: "Cập nhật thông tin thành công",
      data: formattedUser,
    });
  } catch (error) {
    console.error("Lỗi updateUser:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const SALT_ROUNDS = 10;

const changePassword = async (req, res) => {
  try {
    const { id } = req.params;
    let { old_password, new_password, confirm_password } = req.body;

    // 1️⃣ Trim input để loại bỏ khoảng trắng thừa
    old_password = old_password?.trim();
    new_password = new_password?.trim();
    confirm_password = confirm_password?.trim();

    // 2️⃣ Kiểm tra nhập đủ
    if (!old_password || !new_password || !confirm_password) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập đầy đủ các trường mật khẩu" });
    }

    // 3️⃣ Tìm user
    const user = await model.users.findByPk(id, {
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // 4️⃣ Kiểm tra mật khẩu cũ
    const isOldPasswordValid = await bcrypt.compare(
      old_password,
      user.password
    );
    if (!isOldPasswordValid) {
      return res.status(400).json({ message: "Mật khẩu cũ không đúng" });
    }

    // 5️⃣ Kiểm tra confirm password
    if (new_password !== confirm_password) {
      return res
        .status(400)
        .json({ message: "Mật khẩu mới và xác nhận không khớp" });
    }

    // 6️⃣ Validate độ dài password
    if (new_password.length < 8) {
      return res
        .status(400)
        .json({ message: "Mật khẩu mới phải có ít nhất 8 ký tự" });
    }

    // 7️⃣ Không được trùng mật khẩu cũ
    const isSameAsOld = await bcrypt.compare(new_password, user.password);
    if (isSameAsOld) {
      return res
        .status(400)
        .json({ message: "Mật khẩu mới không được trùng với mật khẩu cũ" });
    }

    // 8️⃣ Hash mật khẩu mới
    const hashedNewPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

    // 9️⃣ Cập nhật DB
    await user.update({ password: hashedNewPassword, updated_at: new Date() });

    // 10️⃣ Format dữ liệu trả về
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
      message: "Đổi mật khẩu thành công",
      data: formattedUser,
    });
  } catch (error) {
    console.error("Lỗi changePassword:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
/** 1. GỬI OTP QUA EMAIL */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const trimmedEmail = email?.trim().toLowerCase();

    // Kiểm tra email hợp lệ
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return res.status(400).json({ message: "Email không hợp lệ" });
    }

    // Kiểm tra user tồn tại
    const user = await model.users.findOne({
      where: { email: { [Op.iLike]: trimmedEmail }, status: "đang hoạt động" },
    });
    if (!user) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy tài khoản hợp lệ" });
    }

    const cooldownKey = `otp:cooldown:${trimmedEmail}`;
    const limitKey = `otp:limit:${trimmedEmail}`;
    const otpKey = `otp:${trimmedEmail}`;
    const cooldownSeconds = 30;

    // ===============================
    // 1️⃣ Chống spam: 30 giây/lần
    // ===============================
    const cooldownSet = await redis.set(cooldownKey, "1", {
      NX: true,
      EX: cooldownSeconds,
    });

    if (!cooldownSet) {
      // Redis Cloud có thể trả TTL -1 hoặc -2, fallback về cooldownSeconds
      let ttl = await redis.ttl(cooldownKey);
      if (ttl < 0) ttl = cooldownSeconds;
      return res.status(429).json({
        message: `Vui lòng đợi ${ttl} giây trước khi yêu cầu OTP mới.`,
      });
    }

    // ===============================
    // 2️⃣ Giới hạn số lần gửi OTP: 3 lần/giờ
    // ===============================
    let sendCount = await redis.incr(limitKey);
    if (sendCount === 1) await redis.expire(limitKey, 2 * 60); 
    if (sendCount > 3) {
      await redis.set(cooldownKey, "1", { EX: 2 * 60 });
      return res.status(429).json({
        message: "Quá nhiều yêu cầu! Vui lòng thử lại sau 2 phút.",
      });
    }

    // ===============================
    // 3️⃣ Tạo và lưu OTP
    // ===============================
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Xóa OTP cũ nếu có (đảm bảo client nhận OTP mới)
    await redis.del(otpKey);
    await redis.set(otpKey, otp, { EX: 2 * 60 }); 

    await sendOTPEmail(trimmedEmail, otp);

    console.log(`✅ OTP sent | Email: ${trimmedEmail} | Lần: ${sendCount}`);
    return res.status(200).json({
      message:
        "Mã OTP đã được gửi (hiệu lực 2 phút). Kiểm tra email (Spam/Junk).",
      data: { email: trimmedEmail },
    });
  } catch (error) {
    console.error("Lỗi forgotPassword:", error);
    return res
      .status(500)
      .json({ message: "Lỗi server, vui lòng thử lại sau" });
  }
};

/** 2. XÁC MINH OTP */
const verifyOTP = async (req, res) => {
  try {
    await connectRedis();
    const { email, otp } = req.body;
    const trimmedEmail = email?.trim().toLowerCase();

    if (!trimmedEmail || !otp || otp.length !== 6) {
      return res.status(400).json({ message: "Dữ liệu không hợp lệ" });
    }

    const key = `otp:${trimmedEmail}`;
    const storedOTP = await redis.get(key);
    if (!storedOTP || storedOTP !== otp) {
      return res
        .status(400)
        .json({ message: "Mã OTP không đúng hoặc đã hết hạn" });
    }

    // Xóa OTP sau khi xác nhận
    await redis.del(key);

    // Tạo token tạm thời 10 phút
    const resetToken = jwt.sign(
      { email: trimmedEmail, purpose: "reset_password" },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "10m" }
    );
    console.log("Reset token: ", resetToken);

    // Lưu token vào Redis để kiểm soát việc sử dụng
    const tokenKey = `reset_token:${trimmedEmail}`;
    await redis.set(tokenKey, resetToken, "EX", 10 * 60);

    return res.status(200).json({
      message: "Xác minh thành công!",
    });
  } catch (error) {
    console.error("Lỗi verifyOTP:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

/** 3. ĐẶT LẠI MẬT KHẨU */
const resetPassword = async (req, res) => {
  try {
    await connectRedis();
    const { new_password, confirm_password } = req.body;

     const trimmedNewPassword = new_password?.trim();
    const trimmedConfirmPassword = confirm_password?.trim();

    // Lấy token từ header Authorization
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(400)
        .json({ message: "Thiếu reset token trong header Authorization" });
    }
    const reset_token = authHeader.split(" ")[1];

    if (!trimmedNewPassword || !trimmedConfirmPassword) {
      return res.status(400).json({ message: "Thiếu thông tin mật khẩu" });
    }

    if (trimmedNewPassword !== trimmedConfirmPassword) {
      return res.status(400).json({ message: "Mật khẩu xác nhận không khớp" });
    }

     if (trimmedNewPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Mật khẩu phải có ít nhất 8 ký tự" });
    }

    // Xác minh token
    let decoded;
    try {
      decoded = jwt.verify(reset_token, process.env.ACCESS_TOKEN_SECRET);
    } catch (err) {
      return res
        .status(400)
        .json({ message: "Token không hợp lệ hoặc đã hết hạn" });
    }

    if (decoded.purpose !== "reset_password") {
      return res
        .status(400)
        .json({ message: "Token không dùng để đặt lại mật khẩu" });
    }

    // Kiểm tra token còn tồn tại trong Redis
    const tokenKey = `reset_token:${decoded.email}`;
    const storedToken = await redis.get(tokenKey);
    if (!storedToken || storedToken !== reset_token) {
      return res
        .status(400)
        .json({ message: "Token đã hết hạn hoặc không hợp lệ" });
    }

    // Tìm user
    const user = await model.users.findOne({ where: { email: decoded.email } });
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy tài khoản" });
    }

    // Cập nhật mật khẩu mới
    const hashedPassword = await bcrypt.hash(trimmedNewPassword, 10);
    await user.update({
      password: hashedPassword,
      updated_at: new Date(),
    });

    // Xóa token sau khi dùng
    await redis.del(tokenKey);

    return res.status(200).json({
      message: "Đặt lại mật khẩu thành công! Bạn có thể đăng nhập ngay.",
    });
  } catch (error) {
    console.error("Lỗi resetPassword:", error.message || error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// Lấy danh sách người dùng theo status
const getUsersByStatus = async (req, res) => {
  try {
    const { status } = req.query;
    const validStatuses = ["chưa xác nhận", "đang hoạt động", "bị cấm"];
    let condition = {};

    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          message: `Giá trị 'status' không hợp lệ. Các giá trị hợp lệ: ${validStatuses.join(
            ", "
          )}`,
        });
      }
      condition.status = { [Op.eq]: status };
    }

    const usersData = await model.users.findAll({
      where: condition,
      attributes: [
        "user_id",
        "full_name",
        "email",
        "status",
        "gender",
        "birth_date",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
      order: [["createdAt", "DESC"]],
    });

    if (!usersData.length) {
      return res.status(200).json({
        message: "Không có tài khoản nào.",
        count: 0,
        data: [],
      });
    }

    // Format dữ liệu từng user
    const formattedData = usersData.map((user) => ({
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
    }));

    return res.status(200).json({
      message: status
        ? `Danh sách người dùng có status = '${status}'`
        : "Danh sách toàn bộ người dùng",
      count: formattedData.length,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi lọc người dùng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// Lấy danh sách người dùng theo keyword (với phân trang)
const getUserByKeyword = async (req, res) => {
  try {
    const { keyword = "", page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;

    const whereCondition = keyword
      ? {
          [Op.or]: [
            { full_name: { [Op.iLike]: `%${keyword}%` } },
            { email: { [Op.iLike]: `%${keyword}%` } },
          ],
        }
      : {};

    const totalUsers = await model.users.count({ where: whereCondition });
    const totalPages = Math.ceil(totalUsers / pageSize);

    if (totalUsers === 0) {
      return res.status(200).json({
        message: "Không có tài khoản nào.",
        totalUsers: 0,
        currentPage: 1,
        totalPages: 0,
        data: [],
      });
    }

    const validPage = Math.min(pageNum, totalPages || 1);
    const offset = (validPage - 1) * pageSize;

    const usersData = await model.users.findAll({
      where: whereCondition,
      attributes: [
        "user_id",
        "full_name",
        "email",
        "status",
        "birth_date",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: model.roles,
          as: "role",
          attributes: ["role_id", "role_name"],
        },
      ],
      order: [["createdAt", "DESC"]],
      offset,
      limit: pageSize,
    });

    const formattedData = usersData.map((user) => ({
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      status: user.status,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      role_id: user.role?.role_id || null,
      role_name: user.role?.role_name || null,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    }));

    return res.status(200).json({
      message: "Lấy danh sách người dùng thành công",
      totalUsers,
      currentPage: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi tìm kiếm người dùng:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const assignUserRole = async (req, res) => {
  try {
    const { user_id } = req.params; // lấy user_id từ URL
    const { role_id } = req.body; // role_id gửi trong body

    if (!role_id) {
      return res.status(400).json({ message: "Thiếu role_id" });
    }

    // Kiểm tra user tồn tại
    const user = await model.users.findByPk(user_id);
    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    }

    // Kiểm tra role tồn tại
    const role = await model.roles.findByPk(role_id);
    if (!role) {
      return res.status(404).json({ message: "Role không tồn tại" });
    }

    // Gán role
    user.role_id = role_id;
    await user.save();

    // Format dữ liệu user trả về
    const formattedUser = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      birth_date: user.birth_date ? formatVNDate(user.birth_date) : null,
      status: user.status,
      gender: user.gender,
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
      role_id: role.role_id,
      role_name: role.role_name,
    };

    return res.status(200).json({
      message: `Gán role '${role.role_name}' cho user '${user.full_name}' thành công`,
      data: formattedUser,
    });
  } catch (error) {
    console.error("Lỗi gán role:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const getAllRoles = async (req, res) => {
  try {
    // Lấy toàn bộ roles từ DB
    const roles = await model.roles.findAll({
      attributes: ["role_id", "role_name"],
      order: [["role_id", "ASC"]],
    });

    // Format dữ liệu
    const formatted = roles.map((role) => ({
      role_id: role.role_id,
      role_name: role.role_name,
    }));

    return res.status(200).json({
      message: "Lấy danh sách role thành công",
      data: formatted,
    });
  } catch (error) {
    console.error("Lỗi getAllRoles:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const createRole = async (req, res) => {
  try {
    const { role_name } = req.body;

    if (!role_name || !role_name.trim()) {
      return res.status(400).json({ message: "Tên role không được để trống" });
    }

    const trimmedName = role_name.trim();

    // Kiểm tra trùng tên
    const exists = await model.roles.findOne({
      where: { role_name: trimmedName },
    });

    if (exists) {
      return res.status(400).json({ message: "Role đã tồn tại" });
    }

    const newRole = await model.roles.create({ role_name: trimmedName });

    return res.status(201).json({
      message: "Tạo role thành công",
      data: {
        role_id: newRole.role_id,
        role_name: newRole.role_name,
      },
    });
  } catch (error) {
    console.error("Lỗi thêm role:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};
const updateRole = async (req, res) => {
  try {
    const { role_id } = req.params;
    const { role_name } = req.body;

    // 1. Kiểm tra có gửi role_name không + trim
    if (!role_name || typeof role_name !== "string" || !role_name.trim()) {
      return res.status(400).json({ message: "Tên role không được để trống" });
    }

    const trimmedName = role_name.trim();

    // 2. Ràng buộc: chỉ được chữ cái (có/không dấu), số và khoảng trắng
    const validRoleNameRegex = /^[a-zA-ZÀ-ỹ0-9\s]+$/;

    if (!validRoleNameRegex.test(trimmedName)) {
      return res.status(400).json({
        message: "Tên role chỉ được chứa chữ cái, số và khoảng trắng, không được dùng ký tự đặc biệt",
      });
    }

    // 3. Kiểm tra role có tồn tại không
    const role = await model.roles.findByPk(role_id);
    if (!role) {
      return res.status(404).json({ message: "Role không tồn tại" });
    }

    // 4. Kiểm tra trùng tên role (trừ chính nó)
    const duplicate = await model.roles.findOne({
      where: {
        role_name: trimmedName,
        role_id: { [Op.ne]: role_id },
      },
    });

    if (duplicate) {
      return res.status(400).json({ message: "Tên role đã tồn tại" });
    }

    // 5. Cập nhật
    role.role_name = trimmedName;
    await role.save();

    return res.status(200).json({
      message: "Cập nhật role thành công",
      data: {
        role_id: role.role_id,
        role_name: role.role_name,
      },
    });
  } catch (error) {
    console.error("Lỗi cập nhật role:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

const deleteRole = async (req, res) => {
  try {
    const { role_id } = req.params;

    const role = await model.roles.findByPk(role_id);
    if (!role) {
      return res.status(404).json({ message: "Role không tồn tại" });
    }

    // Kiểm tra có user nào đang dùng role này không
    const userCount = await model.users.count({ where: { role_id } });
    if (userCount > 0) {
      return res.status(400).json({
        message: "Không thể xoá role vì đang được người dùng sử dụng",
      });
    }

    await role.destroy();

    return res.status(200).json({ message: "Xoá role thành công" });
  } catch (error) {
    console.error("Lỗi xoá role:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};




export {
  registerUser,
  verifyEmail,
  loginUser,
  refreshTokenRoute,
  getAllUsers,
  getUserById,
  updateStatus,
  updateUser,
  changePassword,
  forgotPassword,
  verifyOTP,
  resetPassword,
  getUsersByStatus,
  getUserByKeyword,
  assignUserRole,
  getAllRoles,
  createRole,
  updateRole,
  deleteRole,
};
