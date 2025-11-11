import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { Op } from "sequelize";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { sendVerificationEmail, sendConfirmationEmail } from "../config/email.js";

dotenv.config();
const model = initModels(sequelize);

/** ============ ĐĂNG KÝ NGƯỜI DÙNG ============ */
const registerUser = async (req, res) => {
  try {
    const { full_name, email, password } = req.body;

    // BƯỚC 1: KIỂM TRA THIẾU TRƯỜNG
    if (!full_name || !email || !password) {
      return res.status(400).json({ message: "Thiếu thông tin đăng ký" });
    }

    // BƯỚC 2: KIỂM TRA EMAIL ĐÃ TỒN TẠI CHƯA (không phân biệt hoa/thường)
    const existingUser = await model.users.findOne({ 
      where: { 
        email: { [Op.iLike]: email } 
      } 
    });

    if (existingUser) {
      if (existingUser.status === true) {
        return res.status(400).json({
          message: "Email đã được sử dụng. Vui lòng nhập email khác.",
        });
      } else {
        return res.status(400).json({
          message: "Email này đã được đăng ký nhưng chưa xác nhận. Vui lòng kiểm tra email (bao gồm mục Spam/Junk) để xác nhận tài khoản.",
        });
      }
    }

    // BƯỚC 3: TẠO NGƯỜI DÙNG MỚI
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await model.users.create({
      full_name,
      email,
      password: hashedPassword,
      role: "customer",
      status: false,
    });

    // BƯỚC 4: TẠO TOKEN + GỬI EMAIL XÁC NHẬN
    const verificationToken = jwt.sign(
      { user_id: newUser.user_id, email: newUser.email },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "15m" }
    );

    console.log("TOKEN XÁC NHẬN:", verificationToken);
    await sendVerificationEmail(newUser.email, verificationToken);

    return res.status(201).json({
      message: "Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản.",
    });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);

    // BẮT LỖI TRÙNG EMAIL TỪ DATABASE (nếu constraint DB hoạt động)
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        message: "Email này đã được đăng ký. Vui lòng kiểm tra email (Spam/Junk) để xác nhận hoặc dùng email khác."
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
    if (user.status === true) {
      return res.send(`
        <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#f0fff4;">
          <h3 style="color:#48bb78;">Tài khoản đã được xác nhận</h3>
          <p>Bạn có thể đăng nhập ngay bây giờ.</p>
          <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/login"
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
      await user.update({ status: true });
      await sendConfirmationEmail(user.email, user.full_name);

      return res.send(`
        <div style="text-align:center; padding:60px; font-family: Arial, sans-serif; background:#f0fff4; min-height:100vh;">
          <div style="background:white; padding:40px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.1); max-width:500px; margin:0 auto;">
            <h2 style="color:#48bb78; margin-bottom:16px;">Xác nhận thành công!</h2>
            <p style="font-size:16px; color:#2d3748;">Chào mừng <strong>${user.full_name}</strong>!</p>
            <p style="color:#718096; margin:20px 0;">Tài khoản đã được kích hoạt.</p>
            <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/login"
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
              <h3 style="color:#48bb78; margin:16px 0; font-size:18px;">${user.email}</h3>
              <p style="color:#718096;">
                Vui lòng kiểm tra <strong>hộp thư đến</strong> và <strong>mục Spam/Junk</strong>.<br>
                Link mới có hiệu lực trong <strong>15 phút</strong>.
              </p>
              <p style="margin-top:24px; font-size:14px; color:#a0aec0;">
                <em>Thời gian hiện tại: ${new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</em>
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
      return res.status(400).json({ message: "Email hoặc mật khẩu không đúng" });

    if (!user.status)
      return res.status(403).json({ message: "Tài khoản chưa xác nhận email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Email hoặc mật khẩu không đúng" });

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
    return res.status(401).json({ message: "Refresh token không hợp lệ hoặc đã hết hạn" });
  }
};

/** ============ LẤY DANH SÁCH NGƯỜI DÙNG ============ */
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, keyword = "" } = req.query;
    const offset = (page - 1) * limit;

    const where = keyword
      ? {
          [Op.or]: [
            { full_name: { [Op.iLike]: `%${keyword}%` } },
            { email: { [Op.iLike]: `%${keyword}%` } },
          ],
        }
      : {};

    const { count, rows } = await model.users.findAndCountAll({
      where,
      attributes: [
        "user_id", "full_name", "email", "gender",
        "birth_date", "status", "role", "createdAt"
      ],
      order: [["user_id", "DESC"]],
      limit: Number(limit),
      offset: Number(offset),
    });

    return res.status(200).json({
      message: "Lấy danh sách người dùng thành công",
      total: count,
      page: Number(page),
      totalPages: Math.ceil(count / limit),
      data: rows,
    });
  } catch (error) {
    console.error("Lỗi getAllUsers:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

export {
  registerUser,
  verifyEmail,
  loginUser,
  refreshTokenRoute,
  getAllUsers,
};