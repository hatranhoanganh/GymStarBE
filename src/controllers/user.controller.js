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

      // === BƯỚC 1: KIỂM TRA THIẾU TRƯỜNG + TRIM ===
      const trimmedFullName = full_name?.trim();
      const trimmedEmail = email?.trim().toLowerCase();
      const trimmedPassword = password?.trim();

      if (!trimmedFullName || !trimmedEmail || !trimmedPassword) {
        return res
          .status(400)
          .json({ message: "Vui lòng nhập đầy đủ họ tên, email và mật khẩu" });
      }

      // === BƯỚC 2: VALIDATE EMAIL ===
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        return res
          .status(400)
          .json({
            message:
              "Email không hợp lệ. Vui lòng nhập đúng định dạng (ví dụ: abc@example.com)",
          });
      }

      // === BƯỚC 3: VALIDATE MẬT KHẨU (≥ 8 ký tự) ===
      if (trimmedPassword.length < 8) {
        return res
          .status(400)
          .json({ message: "Mật khẩu phải có ít nhất 8 ký tự" });
      }

      // === BƯỚC 4: KIỂM TRA EMAIL ĐÃ TỒN TẠI ===
      const existingUser = await model.users.findOne({
        where: {
          email: { [Op.iLike]: trimmedEmail },
        },
      });

      if (existingUser) {
        if (existingUser.status === "active") {
          return res.status(400).json({
            message: "Email đã được sử dụng. Vui lòng nhập email khác.",
          });
        } else if (existingUser.status === "unverified") {
          return res.status(400).json({
            message:
              "Email này đã được đăng ký nhưng chưa xác nhận. Vui lòng kiểm tra email (bao gồm mục Spam/Junk) để xác nhận tài khoản.",
          });
        } else if (existingUser.status === "disabled") {
          return res.status(400).json({
            message:
              "Tài khoản này đã bị vô hiệu hóa.",
          });
        }
      }

      // === BƯỚC 5: HASH MẬT KHẨU ===
      const hashedPassword = await bcrypt.hash(trimmedPassword, 10);

      // === BƯỚC 6: TẠO USER MỚI ===
      const newUser = await model.users.create({
        full_name: trimmedFullName,
        email: trimmedEmail,
        password: hashedPassword,
        role: "customer",
        status: "unverified",
      });

      // === BƯỚC 7: TẠO TOKEN + GỬI EMAIL ===
      const verificationToken = jwt.sign(
        { user_id: newUser.user_id, email: newUser.email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "15m" }
      );

      console.log("TOKEN XÁC NHẬN:", verificationToken);
      await sendVerificationEmail(newUser.email, verificationToken);

      // === BƯỚC 8: TRẢ KẾT QUẢ ===
      return res.status(201).json({
        message:
          "Đăng ký thành công! Vui lòng kiểm tra email (Spam/Junk) để xác nhận tài khoản.",
      });
    } catch (error) {
      console.error("Lỗi đăng ký:", error);

      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({
          message:
            "Email này đã được đăng ký. Vui lòng kiểm tra email (Spam/Junk) để xác nhận hoặc dùng email khác.",
        });
      }

      return res.status(500).json({ message: "Lỗi server" });
    }
  };
  /** ============ XÁC NHẬN EMAIL – ĐÃ SỬA 100% LOGIC ============ */
  /** ============ XÁC NHẬN EMAIL – GỬI LẠI KHI HẾT HẠN ============ */
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
            <h3 style="color:#e53e3e;">Mã xác nhận không hợp lệ</h3>
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
      if (user.status === "active") {
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
        await user.update({ status: "active" });
        await sendConfirmationEmail(user.email, user.full_name);

        return res.send(`
          <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#f0fff4; min-height:100vh;">
            <div style="background:white; padding:40px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); max-width:500px; margin:0 auto;">
              <h2 style="color:#48bb78; margin-bottom:16px;">Xác nhận thành công!</h2>
              <p style="font-size:16px; color:#2d3748;">Chào mừng <strong>${
                user.full_name
              }</strong>!</p>
              <p style="color:#718096; margin:20px 0;">Tài khoản đã được kích hoạt.</p>
              <a href="${process.env.CLIENT_URL || "http://localhost:5173"}/login"
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
            { expiresIn: "15m" }
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
                  Link mới có hiệu lực trong <strong>15 phút</strong>.
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
      const user = await model.users.findOne({ where: { email } });

      if (!user)
        return res
          .status(400)
          .json({ message: "Email hoặc mật khẩu không đúng" });

      if (user.status === "unverified") {
        return res
          .status(403)
          .json({
            message:
              "Email này đã được đăng ký nhưng chưa xác nhận. Vui lòng kiểm tra email (bao gồm mục Spam/Junk) để xác nhận tài khoản.",
          });
      }

      if (user.status === "disabled") {
        return res
          .status(403)
          .json({
            message:
              "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.",
          });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch)
        return res
          .status(400)
          .json({ message: "Email hoặc mật khẩu không đúng" });

      const accessToken = jwt.sign(
        { user_id: user.user_id, email: user.email, role: user.role },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "15m" }
      );

      const refreshToken = jwt.sign(
        { user_id: user.user_id },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        message: "Đăng nhập thành công",
        accessToken,
        refreshToken,
        user: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
        },
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
      const { page = 1, limit = 10, keyword = "" } = req.query;

      const pageNum = parseInt(page) || 1;
      const pageSize = parseInt(limit) || 10;

      // Điều kiện tìm kiếm
      const where = keyword
        ? {
            [Op.or]: [
              { full_name: { [Op.iLike]: `%${keyword}%` } },
              { email: { [Op.iLike]: `%${keyword}%` } },
            ],
          }
        : {};

      // Đếm tổng số user
      const count = await model.users.count({ where });

      // Tính tổng số trang
      const totalPages = Math.ceil(count / pageSize);

      // Nếu không có dữ liệu => trả về sớm
      if (count === 0) {
        return res.status(200).json({
          message: "Không có dữ liệu người dùng.",
          total: 0,
          page: 1,
          totalPages: 0,
          data: [],
        });
      }

      // Giữ cho page không vượt quá tổng trang
      const validPage = Math.min(pageNum, totalPages || 1);
      const offset = (validPage - 1) * pageSize;

      // Lấy dữ liệu
      const rows = await model.users.findAll({
        where,
        attributes: [
          "user_id",
          "full_name",
          "email",
          "gender",
          "birth_date",
          "status",
          "role",
          "createdAt",
          "updatedAt",
        ],
        limit: pageSize,
        offset,
      });

      // Nếu trang hợp lệ mà không có dữ liệu (hiếm gặp) => vẫn trả message
      if (rows.length === 0) {
        return res.status(200).json({
          message: "Không có dữ liệu ở trang này.",
          total: count,
          page: validPage,
          totalPages,
          data: [],
        });
      }
      // Format createdAt và updatedAt
      const formattedData = rows.map((user) => ({
        ...user.toJSON(),
        birth_date: formatVNDate(user.birth_date),
        createdAt: formatVNDateTime(user.createdAt),
        updatedAt: formatVNDateTime(user.updatedAt),
      }));

      // Trả dữ liệu bình thường
      return res.status(200).json({
        message: "Lấy danh sách người dùng thành công",
        total: count,
        page: validPage,
        totalPages,
        data: rows,
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
      const { id } = req.params; // Lấy user_id từ URL
      if (!id) {
        return res.status(400).json({ message: "Thiếu user_id" });
      }

      const user = await model.users.findByPk(id, {
        attributes: [
          "user_id",
          "full_name",
          "email",
          "gender",
          "birth_date",
          "status",
          "role",
          "createdAt",
          "updatedAt",
        ],
      });

      if (!user) {
        return res.status(404).json({ message: "Không tìm thấy người dùng" });
      }
      const formattedUser = {
        ...user.toJSON(),
        birth_date: formatVNDate(user.birth_date),
        createdAt: formatVNDateTime(user.createdAt),
        updatedAt: formatVNDateTime(user.updatedAt),
      };

      return res.status(200).json({
        message: "Lấy thông tin người dùng thành công",
        data: user,
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

    const user = await model.users.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    // Không cho đổi trạng thái nếu chưa xác nhận email
    if (user.status === "unverified") {
      return res.status(400).json({
        message: "Không thể thay đổi trạng thái tài khoản chưa xác nhận email",
      });
    }

    let newStatus;
    if (user.status === "active") {
      newStatus = "disabled"; // đang active → vô hiệu hóa
    } else if (user.status === "disabled" || user.status === null) {
      newStatus = "active"; // đang disabled → bật lại
    } else {
      return res.status(400).json({
        message: `Không thể thay đổi trạng thái tài khoản với trạng thái hiện tại: ${user.status}`,
      });
    }

    await user.update({ status: newStatus });

    return res.status(200).json({
      message: `Thay đổi trạng thái thành công. Trạng thái mới: ${newStatus}`,
      data: {
        user_id: user.user_id,
        full_name: user.full_name,
        email: user.email,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Lỗi toggleUserStatus:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};




  const  updateUser = async (req, res) => {
    try {
      const { id } = req.params;
      const { full_name, gender, birth_date } = req.body;

      // 1. Tìm user theo ID
      const user = await model.users.findByPk(id);
      if (!user) {
        return res.status(404).json({ message: "Không tìm thấy người dùng" });
      }

      // 2. Chuẩn bị dữ liệu cập nhật
      const updateData = {};

      // Xử lý full_name
      if (full_name !== undefined) {
        const trimmedName = full_name.trim();
        if (trimmedName === "") {
          return res.status(400).json({ message: "Tên không được để trống" });
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

      // Xử lý birth_date (DD-MM-YYYY → YYYY-MM-DD)
      if (birth_date !== undefined) {
        const trimmed = birth_date?.trim();

        if (!trimmed || trimmed === "") {
          updateData.birth_date = null;
        } else {
          // Kiểm tra định dạng DD-MM-YYYY
          if (!/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
            return res
              .status(400)
              .json({ message: "Ngày sinh phải định dạng DD-MM-YYYY" });
          }

          const [day, month, year] = trimmed.split("-").map(Number);

          // Kiểm tra giá trị cơ bản
          if (
            day < 1 ||
            day > 31 ||
            month < 1 ||
            month > 12 ||
            year < 1900 ||
            year > 2100
          ) {
            return res
              .status(400)
              .json({ message: "Ngày/tháng/năm không hợp lệ" });
          }

          // Kiểm tra ngày thực sự tồn tại (31-02-2023 → sai)
          const dateObj = new Date(year, month - 1, day);
          if (
            dateObj.getFullYear() !== year ||
            dateObj.getMonth() !== month - 1 ||
            dateObj.getDate() !== day
          ) {
            return res
              .status(400)
              .json({ message: "Ngày sinh không tồn tại (ví dụ: 31-02-2023)" });
          }

          // Chuyển sang định dạng YYYY-MM-DD để lưu vào DB
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
        birth_date: formatVNDate(user.birth_date), // DD/MM/YYYY
        status: user.status,
        role: user.role,
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
      const { old_password, new_password, confirm_password } = req.body;

      // 1. Tìm user
      const user = await model.users.findByPk(id);
      if (!user) {
        return res.status(404).json({ message: "Không tìm thấy người dùng" });
      }

      // 2. Kiểm tra mật khẩu cũ
      const isOldPasswordValid = await bcrypt.compare(
        old_password,
        user.password
      );
      if (!isOldPasswordValid) {
        return res.status(400).json({ message: "Mật khẩu cũ không đúng" });
      }

      // 3. Kiểm tra xác nhận mật khẩu
      if (new_password !== confirm_password) {
        return res
          .status(400)
          .json({ message: "Mật khẩu mới và xác nhận không khớp" });
      }

      // 4. Validate: chỉ cần ≥ 8 ký tự
      if (!new_password || new_password.length < 8) {
        return res
          .status(400)
          .json({ message: "Mật khẩu mới phải có ít nhất 8 ký tự" });
      }

      // 5. Không cho phép trùng mật khẩu cũ
      const isSameAsOld = await bcrypt.compare(new_password, user.password);
      if (isSameAsOld) {
        return res
          .status(400)
          .json({ message: "Mật khẩu mới không được trùng với mật khẩu cũ" });
      }

      // 6. Hash mật khẩu mới
      const hashedNewPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

      // 7. Cập nhật DB
      await user.update({
        password: hashedNewPassword,
        updated_at: new Date(),
      });

      // 8. Trả về thành công
      return res.status(200).json({
        message: "Đổi mật khẩu thành công",
        data: {
          user_id: user.user_id,
          full_name: user.full_name,
          email: user.email,
          updatedAt: formatVNDateTime(user.updatedAt),
        },
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
        where: { email: { [Op.iLike]: trimmedEmail }, status: "active" },
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
      if (sendCount === 1) await redis.expire(limitKey, 60 * 60); // set TTL 1 giờ
      if (sendCount > 3) {
        await redis.set(cooldownKey, "1", { EX: 60 * 60 }); // chặn thêm 1 giờ
        return res.status(429).json({
          message: "Quá nhiều yêu cầu! Vui lòng thử lại sau 59 phút.",
        });
      }

      // ===============================
      // 3️⃣ Tạo và lưu OTP
      // ===============================
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      // Xóa OTP cũ nếu có (đảm bảo client nhận OTP mới)
      await redis.del(otpKey);
      await redis.set(otpKey, otp, { EX: 15 * 60 }); // hiệu lực 15 phút

      await sendOTPEmail(trimmedEmail, otp);

      console.log(`✅ OTP sent | Email: ${trimmedEmail} | Lần: ${sendCount}`);
      return res.status(200).json({
        message:
          "Mã OTP đã được gửi (hiệu lực 15 phút). Kiểm tra email (Spam/Junk).",
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

      // Lưu token vào Redis để kiểm soát việc sử dụng
      const tokenKey = `reset_token:${trimmedEmail}`;
      await redis.set(tokenKey, resetToken, "EX", 10 * 60);

      return res.status(200).json({
        message: "Xác minh thành công!",
        data: { reset_token: resetToken },
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
      const { reset_token, new_password, confirm_password } = req.body;

      if (!reset_token || !new_password || !confirm_password) {
        return res.status(400).json({ message: "Thiếu thông tin bắt buộc" });
      }
      if (new_password !== confirm_password) {
        return res.status(400).json({ message: "Mật khẩu xác nhận không khớp" });
      }
      if (new_password.length < 8) {
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

      // Kiểm tra token có còn tồn tại trong Redis không
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

      // // Không cho dùng lại mật khẩu cũ
      // const isSamePassword = await bcrypt.compare(new_password, user.password);
      // if (isSamePassword) {
      //   return res.status(400).json({ message: 'Mật khẩu mới không được trùng mật khẩu cũ' });
      // }

      // Cập nhật mật khẩu mới
      const hashedPassword = await bcrypt.hash(new_password, 10);
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
    const validStatuses = ["unverified", "active", "disabled"];
    let condition = {};

    if (status) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          message: `Giá trị 'status' không hợp lệ. Các giá trị hợp lệ: ${validStatuses.join(", ")}`,
        });
      }
      condition.status = { [Op.eq]: status };
    }

    const users = await model.users.findAll({
      where: condition,
      attributes: [
        "user_id",
        "full_name",
        "email",
        "role",
        "status",
        "birth_date",
        "createdAt",
        "updatedAt",
      ],
      order: [["createdAt", "DESC"]],
    });

    if (users.length === 0) {
      return res.status(200).json({
        message: "Không có tài khoản nào.",
        count: 0,
        data: [],
      });
    }

    const formattedData = users.map((user) => ({
      ...user.toJSON(),
      birth_date: formatVNDate(user.birth_date),
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    }));

    return res.status(200).json({
      message: status
        ? `Danh sách người dùng có status = '${status}'`
        : "Danh sách toàn bộ người dùng",
      count: users.length,
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

    const count = await model.users.count({ where: whereCondition });
    const totalPages = Math.ceil(count / pageSize);

    if (count === 0) {
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

    const rows = await model.users.findAll({
      where: whereCondition,
      attributes: [
        "user_id",
        "full_name",
        "email",
        "role",
        "status",
        "birth_date",
        "createdAt",
        "updatedAt",
      ],
      order: [["createdAt", "DESC"]],
      offset,
      limit: pageSize,
    });

    if (rows.length === 0) {
      return res.status(200).json({
        message: "Không có tài khoản nào ở trang này.",
        totalUsers: count,
        currentPage: validPage,
        totalPages,
        data: [],
      });
    }

    const formattedData = rows.map((user) => ({
      ...user.toJSON(),
      birth_date: formatVNDate(user.birth_date),
      createdAt: formatVNDateTime(user.createdAt),
      updatedAt: formatVNDateTime(user.updatedAt),
    }));

    return res.status(200).json({
      message: "Lấy danh sách người dùng thành công",
      totalUsers: count,
      currentPage: validPage,
      totalPages,
      data: formattedData,
    });
  } catch (error) {
    console.error("Lỗi tìm kiếm người dùng:", error);
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
  };