import axios from "axios";
import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import { detectIntent } from "../utils/detectIntent.js";

const model = initModels(sequelize);
dotenv.config();
const HF_API_URL = "https://router.huggingface.co/v1/chat/completions";

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
                `- Màu ${v.color}, Size ${
                  v.size
                }, Giá ${v.price.toLocaleString()}đ, Tồn kho ${v.stock}`
            )
            .join("\n");

          return `Sản phẩm: ${p.name}\n${variants}`;
        })
        .join("\n\n");
    }

   if (intent === "PROMOTION") {
    relatedProducts = [];
  const promotions = await model.promotions.findAll({
    where: { status: "active" },
    order: [["start_date", "DESC"]],
  });

  context = promotions.length
    ? promotions
        .map((p) => {
          const discount =
            p.discount_type === "percent"
              ? `giảm ${p.value}%`
              : `giảm ${Number(p.value).toLocaleString()}đ`;

          const max =
            p.max_discount
              ? `, tối đa ${Number(p.max_discount).toLocaleString()}đ`
              : "";

          const minOrder =
            p.min_order_value && Number(p.min_order_value) > 0
              ? `Đơn tối thiểu ${Number(p.min_order_value).toLocaleString()}đ.`
              : "";

          const desc = p.description ? `${p.description}` : "";

          return `- Mã ${p.code}: ${discount}${max}.
  ${minOrder}
  ${desc}`;
        })
        .join("\n\n")
    : "Hiện shop chưa có chương trình khuyến mãi nào.";
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
                `Đơn #${o.order_id}: Trạng thái ${
                  o.status
                }, Tổng ${o.total.toLocaleString()}đ`
            )
            .join("\n")
        : "Bạn chưa có đơn hàng nào.";
    }

if (intent === "RETURN") {
  return res.json({
    answer: `Chính sách đổi hàng của shop:

- Hiện tại shop chưa hỗ trợ hoàn tiền và trả hàng.
- Shop chỉ hỗ trợ đổi hàng hoặc đổi size.
- Khi đổi hàng, khách hàng cần đổi sang sản phẩm có giá bằng hoặc cao hơn sản phẩm đã mua.
- Nếu sản phẩm đổi có giá cao hơn, khách hàng vui lòng bù thêm phần chênh lệch.
- Để đổi hàng, khách hàng vui lòng nhắn tin qua:
  + Zalo: 028 3850 5520
  + Facebook: https://www.facebook.com/DHCNSG
  để được hướng dẫn chi tiết.

Điều kiện đổi hàng:
- Hỗ trợ đổi trong vòng 15 ngày kể từ khi nhận hàng.
- Sản phẩm còn nguyên tem, chưa qua sử dụng.
- Áp dụng cho các trường hợp: sản phẩm bị lỗi, giao nhầm sản phẩm.`,
    products: [],
  });
}




if (intent === "CANCEL") {
  return res.json({
    answer: `Chính sách hủy đơn hàng:

- Khách hàng cần cung cấp lý do khi hủy đơn.

- Đối với đơn hàng thanh toán COD:
  + Chỉ có thể hủy khi đơn đang ở các trạng thái:
    • chờ xác nhận
    • đã xác nhận
    • đang xử lý
    • đang giao
  + Không thể hủy nếu đơn đã hoàn thành hoặc đã bị hủy trước đó.

- Đối với đơn hàng thanh toán MOMO:
  + Nếu sau 15 phút kể từ khi đặt hàng mà chưa thanh toán thành công, đơn hàng sẽ tự động bị hủy.
  + Nếu đơn hàng đã thanh toán MOMO thành công thì không thể hủy.

- Khi hủy đơn thành công:
  + Đơn hàng sẽ được chuyển sang trạng thái "đã hủy".`,
    products: [],
  });
}

if (intent === "SHIPPING") {
  return res.json({
    answer: `Phí vận chuyển:

- Hiện tại shop hỗ trợ freeship cho tất cả đơn hàng.
- Khách hàng không cần trả thêm phí vận chuyển.
- Phí ship hiển thị ở bước xác nhận đơn hàng là 0đ.`,
  });
}





if (intent === "BEST_SELLER") {
  const bestSellers = await model.order_details.findAll({
    attributes: [
      [sequelize.col("product_variant->product.product_id"), "product_id"],
      [sequelize.col("product_variant->product.name"), "name"],
      [sequelize.col("product_variant->product.thumbnail"), "thumbnail"],
      [
        sequelize.fn(
          "SUM",
          sequelize.col("order_details.quantity")
        ),
        "total_sold",
      ],
    ],
    include: [
      {
        model: model.orders,
        as: "order",
        attributes: [],
        where: { status: "đã giao" },
        required: true,
      },
      {
        model: model.product_variants,
        as: "product_variant",
        attributes: [],
        required: true,
        include: [
          {
            model: model.products,
            as: "product",
            attributes: [],
            required: true,
            where: { status: "đang bán" },
          },
        ],
      },
    ],
    group: [
      "product_variant->product.product_id",
      "product_variant->product.name",
      "product_variant->product.thumbnail",
    ],
    order: [[sequelize.literal("total_sold"), "DESC"]],
    limit: 3,
    raw: true, // 🔥 bắt buộc
  });

  relatedProducts = bestSellers.map((item) => ({
    product_id: item.product_id,
    name: item.name,
    thumbnail: item.thumbnail,
    total_sold: Number(item.total_sold),
    link: `/products/${item.product_id}`,
  }));

  context = relatedProducts.length
    ? relatedProducts
        .map(
          (p, i) =>
            `${i + 1}. ${p.name} – Đã bán ${p.total_sold} sản phẩm`
        )
        .join("\n")
    : "Hiện chưa có dữ liệu sản phẩm bán chạy.";
}

if (intent === "DELIVERY_TIME") {
  return res.json({
    answer: `Thời gian giao hàng dự kiến:

- Khu vực nội thành: 1 – 2 ngày làm việc.
- Khu vực ngoại thành / tỉnh: 3 – 5 ngày làm việc.
- Thời gian có thể thay đổi tùy đơn vị vận chuyển và điều kiện thời tiết.
`,
    products: [],
  });
}


 if (!context) {
      return res.json({
        answer: `Mình chưa hiểu rõ câu hỏi của bạn.
Bạn có thể hỏi về:
- Sản phẩm bán chạy
- Mã giảm giá / khuyến mãi
- Đổi trả / hủy đơn
- Thông tin size, màu, giá`,
        products: [],
      });
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

 const noDataPatterns = [
  "không thấy thông tin",
  "không có thông tin",
  "chưa có dữ liệu",
  "không tìm thấy",
];

const shouldHideProducts = noDataPatterns.some((p) =>
  answer.toLowerCase().includes(p)
);  

return res.json({
  answer,
  products: shouldHideProducts ? [] : relatedProducts,
});

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ message: "Lỗi chatbot AI" });
  }
};
