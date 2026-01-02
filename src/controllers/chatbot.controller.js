import axios from "axios";
import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { detectIntent } from "../utils/detectIntent.js";


const model = initModels(sequelize);
dotenv.config();
const HF_API_URL =
  "https://router.huggingface.co/v1/chat/completions";


export const chatbot = async (req, res) => {
  try {
    const { message, user_id } = req.body;

    if (!message) {
      return res.status(400).json({ message: "Thiếu nội dung chat" });
    }

    const intent = detectIntent(message);
    let context = "";
    let relatedProducts = [];

    
    if (["PRICE", "SIZE", "COLOR", "STOCK"].includes(intent)) {
      const products = await model.products.findAll({
        include: [
          {
            model: model.product_variants,
            as: "product_variants",
            attributes: ["color", "size", "price", "stock"],
          },
        ],
        limit: 3,
      });

      relatedProducts = products.map((p) => ({
        product_id: p.product_id,
        name: p.name,
        price: p.product_variants?.[0]?.price,
        thumbnail: p.thumbnail,
        link: `/products/${p.product_id}`,
      }));

      context = products
        .map((p) => {
          const variants = p.product_variants
            .map(
              (v) =>
                `- Màu ${v.color}, Size ${v.size}, Giá ${v.price.toLocaleString()}đ, Tồn kho ${v.stock}`
            )
            .join("\n");

          return `Sản phẩm: ${p.name}\n${variants}`;
        })
        .join("\n\n");
    }


    if (intent === "PROMOTION") {
      const promotions = await model.promotions.findAll({
        where: { status: "active" },
      });

      context = promotions.length
        ? promotions
            .map(
              (p) =>
                `Code ${p.code}: giảm ${p.value}${
                  p.discount_type === "percent" ? "%" : "đ"
                }, tối đa ${p.max_discount}đ`
            )
            .join("\n")
        : "Hiện không có khuyến mãi.";
    }


    if (intent === "ORDER" && user_id) {
      const orders = await model.orders.findAll({
        where: { user_id },
        limit: 3,
      });

      context = orders.length
        ? orders
            .map(
              (o) =>
                `Đơn #${o.order_id}: Trạng thái ${o.status}, Tổng ${o.total.toLocaleString()}đ`
            )
            .join("\n")
        : "Bạn chưa có đơn hàng nào.";
    }

    if (intent === "RETURN") {
      context = `
Quy định huỷ / đổi trả:
- Đơn pending / processing: có thể huỷ
- Đơn đã giao: không thể huỷ
- Hỗ trợ đổi trả trong 7 ngày
      `;
    }

    
    const prompt = `
Bạn là chatbot cho website bán quần áo.

QUY TẮC:
- Chỉ trả lời dựa trên dữ liệu bên dưới
- Không bịa
- Không suy đoán
- Trả lời ngắn gọn, rõ ràng

DỮ LIỆU:
${context || "Không có dữ liệu"}

CÂU HỎI:
${message}

TRẢ LỜI:
`;

    
 const hfRes = await axios.post(
  HF_API_URL,
  {
    model: "meta-llama/Meta-Llama-3-8B-Instruct",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    max_tokens: 300,
  },
  {
    headers: {
      Authorization: `Bearer ${process.env.HF_API_KEY}`,
      "Content-Type": "application/json",
    },
    timeout: 60000,
  }
);




    const answer =
  hfRes.data?.choices?.[0]?.message?.content ||
  "Xin lỗi, tôi chưa có thông tin phù hợp.";

    return res.json({
      answer,
      products: relatedProducts, 
    });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ message: "Lỗi chatbot AI" });
  }
};
