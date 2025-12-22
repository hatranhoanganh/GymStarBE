import multer from "multer";
import fs from "fs/promises";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const utf8Name = Buffer.from(file.originalname, "latin1").toString("utf8");
    const safeName = utf8Name.replace(/\s+/g, "_");
    cb(null, `${timestamp}-${safeName}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    // IMAGE
    "image/jpeg",
    "image/png",
    "image/jpg",
    "image/webp",

    // VIDEO
    "video/mp4",
    "video/webm",
    "video/ogg",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Chỉ cho phép upload ảnh (jpg, png, webp, jpeg) hoặc video (mp4, webm, ogg)"
      ),
      false
    );
  }
};


const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
}).any();

export default upload;
