import multer from "multer";
import fs from "fs/promises";
import path from "path";

// Thư mục lưu file tạm
const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Cấu hình storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Tạo folder nếu chưa tồn tại
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/\s+/g, "_"); // thay khoảng trắng
    cb(null, `${timestamp}-${safeName}`);
  },
});

// File filter: chỉ cho phép ảnh
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ được upload file ảnh!"), false);
  }
};

// Multer config
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// Export default: dùng trực tiếp upload trong router
export default upload.any(); // nhận tất cả file dynamic field
