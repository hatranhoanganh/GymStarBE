import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Cấu hình multer để lưu file tạm thời vào thư mục 'uploads'
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    // Kiểm tra và tạo thư mục nếu chưa tồn tại
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log('Đã tạo thư mục uploads/');
    }
    cb(null, uploadDir); // Thư mục tạm để lưu file trước khi upload lên Cloudinary
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname); // Đặt tên file với timestamp để tránh trùng
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Chỉ cho phép upload file ảnh
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ được upload file ảnh!'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // Giới hạn kích thước file: 5MB
});

export default upload;