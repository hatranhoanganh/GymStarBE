import rateLimit from 'express-rate-limit';

export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { message: "Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});