import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const sendVerificationEmail = async (email, token) => {
  const verifyLink = `${
    process.env.CLIENT_URL || "http://localhost:5000"
  }/QuanLyNguoiDung/verify-email?token=${token}`;

  await sgMail.send({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: "Xác nhận email đăng ký GymStar",
    html: `
      <div style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: 'Helvetica Neue', Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 60px 20px;">
          <tr>
            <td align="center">
              <!-- Container chính -->
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 0; overflow: hidden;">
                
                <!-- Header minimalist -->
                <tr>
                  <td style="background-color: #000000; padding: 50px 40px; text-align: center; border-bottom: 1px solid #e5e5e5;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 300; letter-spacing: 8px; text-transform: uppercase;">
                      GYMSTAR
                    </h1>
                  </td>
                </tr>

                <!-- Nội dung chính -->
                <tr>
                  <td style="padding: 60px 50px;">
                    
                    <h2 style="margin: 0 0 15px 0; color: #000000; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">
                      Xác nhận tài khoản
                    </h2>
                    
                    <p style="margin: 0 0 25px 0; color: #333333; font-size: 16px; line-height: 1.8;">
                      Chúng tôi đã nhận được yêu cầu đăng ký tài khoản với email <strong>${email}</strong>
                    </p>

                    <p style="margin: 0 0 40px 0; color: #666666; font-size: 15px; line-height: 1.8;">
                      Để kích hoạt tài khoản và bắt đầu trải nghiệm, vui lòng xác nhận địa chỉ email của bạn bằng cách nhấn vào nút bên dưới.
                    </p>

                    <!-- Nút CTA gradient bóng bẩy -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding: 20px 0;">
                          <a href="${verifyLink}" 
                             style="display: inline-block; background: linear-gradient(135deg, black 0%, #c53030 100%); 
                                    color: #ffffff; padding: 16px 48px; text-decoration: none; 
                                    border-radius: 50px; font-size: 16px; font-weight: 600; 
                                    box-shadow: 0 4px 15px rgba(229, 62, 62, 0.4);
                                    transition: all 0.3s ease;">
                            Xác nhận tài khoản
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Box thông tin -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background-color: #f8f8f8; padding: 25px 30px; border-left: 3px solid #000000;">
                          <p style="margin: 0 0 8px 0; color: #000000; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                            Thời gian hiệu lực
                          </p>
                          <p style="margin: 0; color: #666666; font-size: 14px; line-height: 1.6;">
                            Link xác nhận này sẽ hết hạn sau <strong style="color: #000000;">2 phút</strong> kể từ khi email được gửi.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr> 
        </table>  
      </div>  
    `,  
  });
  console.log("Email xác nhận đã gửi:", email);
};


export const sendConfirmationEmail = async (email, full_name) => {
  await sgMail.send({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: "Chào mừng đến với GymStar!",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h2 style="color: #48bb78;">Chào mừng ${full_name}!</h2>
        <p>Tài khoản đã được kích hoạt.</p>
        <a href="${
          process.env.CLIENT_URL || "http://localhost:5173"
        }/dang-nhap" style="background:#48bb78; color:white; padding:12px 24px; text-decoration:none; border-radius:8px;">
          Đăng nhập ngay
        </a>
      </div>
    `,
  });
  console.log("Email chào mừng đã gửi:", email);
};

export const sendOTPEmail = async (email, otp) => {
  await sgMail.send({
    to: email,
    from: process.env.EMAIL_FROM,
    subject: "Mã OTP Đặt Lại Mật Khẩu - GymStar",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px; text-align: center;">
        <h2 style="color: #d32f2f;">Đặt lại mật khẩu</h2>
        <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
        <div style="margin: 30px 0;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #d32f2f;">
            ${otp}
          </span>
        </div>
        <p>Mã OTP này có hiệu lực trong <strong>2 phút</strong>.</p>
        <p style="color: #666; font-size: 14px;">
          Nếu bạn không yêu cầu, vui lòng bỏ qua email này.
        </p>
        <hr>
        <small style="color: #999;">GymStar Team &copy; 2025</small>
      </div>
    `,
  });
  console.log("OTP email đã gửi:", email);
};