import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: 'dqpyuwdi1', // Thay bằng cloud_name của bạn
  api_key: '924671382133846', // Thay bằng api_key của bạn
  api_secret: 'HbUAGzmk44RX07e94TIu5U3sQns', // Thay bằng api_secret của bạn
});

export default cloudinary;