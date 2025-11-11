// src/config/email.js
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// ĐÚNG: export tên hàm
export const sendVerificationEmail = async (email, token) => {
  const verifyLink = `${process.env.CLIENT_URL || 'http://localhost:5000'}/QuanLyNguoiDung/verify-email?token=${token}`;

  await sgMail.send({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: 'Xác nhận email đăng ký GymStar',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2 style="color: #e53e3e;">Xác nhận tài khoản</h2>
        <a href="${verifyLink}" style="background:#e53e3e; color:white; padding:12px 24px; text-decoration:none; border-radius:8px;">
          Xác nhận ngay
        </a>
        <p style="margin-top:15px; color:#666;">Hết hạn sau <strong>15 phút</strong></p>
      </div>
    `,
  });
  console.log("Email xác nhận đã gửi:", email);
};

// ĐÚNG: export tên hàm
export const sendConfirmationEmail = async (email, full_name) => {
  await sgMail.send({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: 'Chào mừng đến với GymStar!',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2 style="color: #48bb78;">Chào mừng ${full_name}!</h2>
        <p>Tài khoản đã được kích hoạt.</p>
        <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/login" style="background:#48bb78; color:white; padding:12px 24px; text-decoration:none; border-radius:8px;">
          Đăng nhập ngay
        </a>
      </div>
    `,
  });
  console.log("Email chào mừng đã gửi:", email);
};