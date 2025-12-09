import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import axios from "axios";
import { createHmac } from "crypto";

dotenv.config();
const model = initModels(sequelize);

const partnerCode = "MOMO";
const accessKey = "F8BBA842ECF85";
const secretKey = "K951B6PE1waDMi640xX08PD3vg6EkVlz";
const endpoint = "https://test-payment.momo.vn/v2/gateway/api/create";
const redirectUrl = "http://localhost:5173/payment-result";
const ipnUrl =
  "https://unblockaded-argentina-habitable.ngrok-free.dev/MoMo/callback-payment";
const requestType = "payWithMethod";

const createMoMoSignature = (params) => {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
};

export const updatePayment = async (req, res) => {
  console.log("MoMo IPN nhận được:", req.body);

  try {
    const {
      partnerCode,
      orderId,
      requestId,
      amount,
      orderInfo,
      orderType,
      transId,
      resultCode,
      message,
      payType,
      responseTime,
      extraData,
      signature,
    } = req.body;

    // Xác thực chữ ký
    const rawSignature = [
      `accessKey=${accessKey}`,
      `amount=${amount}`,
      `extraData=${extraData || ""}`,
      `message=${message}`,
      `orderId=${orderId}`,
      `orderInfo=${orderInfo}`,
      `orderType=${orderType}`,
      `partnerCode=${partnerCode}`,
      `payType=${payType || ""}`,
      `requestId=${requestId}`,
      `responseTime=${responseTime}`,
      `resultCode=${resultCode}`,
      `transId=${transId || ""}`,
    ].join("&");

    const checkSig = createHmac("sha256", secretKey)
      .update(rawSignature)
      .digest("hex");
    if (checkSig !== signature) {
      console.log("CHỮ KÝ SAI → BỎ QUA");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const order_id = JSON.parse(extraData || "{}").order_id;
    if (!order_id) return res.status(400).json({ message: "Thiếu order_id" });

    const [order, payment] = await Promise.all([
      model.orders.findOne({ where: { order_id } }),
      model.payments.findOne({ where: { order_id, method: "MOMO" } }),
    ]);

    if (!order || !payment)
      return res.status(404).json({ message: "Không tìm thấy đơn" });

    // ĐÃ XỬ LÝ RỒI → BỎ QUA
    if (payment.status === "thành công") {
      return res.json({ resultCode: 0, message: "Already processed" });
    }

    if (resultCode == 0) {
      await payment.update({
        status: "thành công",
        payment_date: new Date(Number(responseTime)),
        trans_id: transId?.toString(),
      });
      console.log(`ĐƠN #${order_id} THANH TOÁN THÀNH CÔNG QUA MOMO`);
    } else {
      console.log(
        `MoMo báo thất bại (resultCode=${resultCode}) → sẽ tự xóa sau 1 phút`
      );
      // → KHÔNG GỌI cancelOrderAndRestoreStock ở đây nữa!
    }

    return res.json({ resultCode: 0, message: "OK" });
  } catch (error) {
    console.error("Lỗi IPN MoMo:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export const handlePaymentRequest = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: "Thiếu order_id" });

    // Kiểm tra đơn có tồn tại chưa (phải do placeDirectOrder hoặc placeCartOrder tạo)
    let order = await model.orders.findOne({ where: { order_id } });
    if (!order)
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

    // Chặn nếu đã thanh toán thành công hoặc đã hủy
    const existingPayment = await model.payments.findOne({
      where: { order_id, method: "MOMO" },
    });
    if (existingPayment?.status === "thành công") {
      return res
        .status(400)
        .json({ message: "Đơn hàng đã thanh toán thành công!" });
    }

    // Nếu chưa có payment MoMo → tạo mới
    if (!existingPayment) {
      await model.payments.create(
        {
          order_id,
          method: "MOMO",
          amount: order.total,
          total: order.total,
          status: "đang chờ",
        },
        { transaction: t }
      );
    } else {
      await existingPayment.update({ status: "đang chờ" }, { transaction: t });
    }

    // Tạo link MoMo
    const amount = Math.round(Number(order.total)).toString();
    const momoOrderId = `${order_id}_${Date.now()}`;
    const requestId = momoOrderId;
    const orderInfo = `Thanh toán đơn hàng #${order_id}`;
    const extraData = JSON.stringify({ order_id });

    const signData = {
      accessKey,
      amount,
      extraData,
      ipnUrl,
      orderId: momoOrderId,
      orderInfo,
      partnerCode,
      redirectUrl: "http://localhost:5173/payment-result",
      requestId,
      requestType: "payWithMethod",
    };

    const signature = createHmac("sha256", secretKey)
      .update(createMoMoSignature(signData))
      .digest("hex");

    const requestBody = {
      partnerCode: "MOMO",
      requestId,
      amount,
      orderId: momoOrderId,
      orderInfo,
      redirectUrl: "http://localhost:5173/payment-result",
      ipnUrl,
      extraData,
      requestType: "payWithMethod",
      autoCapture: true,
      signature,
      lang: "vi",
    };

    const response = await axios.post(endpoint, requestBody, {
      headers: { "Content-Type": "application/json" },
    });

    await t.commit();

    // TỰ ĐỘNG HỦY ĐƠN SAU 1 PHÚT NẾU KHÁCH THOÁT
    setTimeout(async () => {
      try {
        const payment = await model.payments.findOne({
          where: { order_id, method: "MOMO", status: "đang chờ" },
        });
        if (payment) {
          await cancelOrderAndRestoreStock(order_id);
          console.log(
            `Đơn #${order_id} tự động hủy do khách thoát MoMo (1 phút)`
          );
        }
      } catch (err) {
        console.error("Lỗi tự động hủy:", err);
      }
    }, 1 * 60 * 1000 + 30 * 1000);

    return res.json({
      message: "Tạo link MoMo thành công",
      payUrl: response.data.payUrl,
      order_id,
    });
  } catch (error) {
    await t.rollback();
    console.error("MoMo Checkout Error:", error.response?.data || error);
    return res.status(500).json({
      message: "Lỗi tạo thanh toán MoMo",
      error: error.response?.data || error.message,
    });
  }
};

export const cancelOrderAndRestoreStock = async (order_id) => {
  let t;
  try {
    t = await sequelize.transaction();

    // Lấy chi tiết đơn để hoàn stock
    const details = await model.order_details.findAll({
      where: { order_id },
      attributes: ["product_variant_id", "quantity"],
      transaction: t,
      lock: t.LOCK.UPDATE, // tránh race condition
    });

    // Hoàn lại số lượng tồn kho
    for (const item of details) {
      await model.product_variants.increment("stock", {
        by: item.quantity,
        where: { product_variant_id: item.product_variant_id },
        transaction: t,
      });
    }

    // Xóa sạch dữ liệu đơn hàng
    await Promise.all([
      model.payments.destroy({ where: { order_id }, transaction: t }),
      model.order_details.destroy({ where: { order_id }, transaction: t }),
      model.orders.destroy({ where: { order_id }, transaction: t }),
    ]);

    await t.commit();
    console.log(
      `Đơn #${order_id} đã được HỦY HOÀN TOÀN + hoàn stock thành công`
    );
  } catch (err) {
    if (t && !t.finished) {
      await t.rollback();
    }
    console.error(`Lỗi khi hủy đơn #${order_id}:`, err);
    // Không throw ra ngoài → hàm này chỉ dùng nội bộ
  }
};

export const retryPayment = async (req, res) => {
  try {
    const { order_id } = req.query;
    const order = await model.orders.findOne({ where: { order_id } });
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn" });

    const payment = await model.payments.findOne({
      where: { order_id, method: "MOMO" },
    });
    if (payment?.status === "thành công") {
      return res.status(400).json({ message: "Đơn đã thanh toán thành công" });
    }

    const result = await prepareMomoPayment(order_id);
    return res.json({ message: "Tạo link mới thành công", data: result });
  } catch (error) {
    return res.status(500).json({ message: "Lỗi", error: error.message });
  }
};

export const prepareMomoPayment = async (order_id) => {
  const order = await model.orders.findOne({ where: { order_id } });
  if (!order) throw new Error("Đơn không tồn tại");

  const amount = Math.round(Number(order.total)).toString();
  const orderId = `${order_id}_${Date.now()}`;
  const requestId = orderId;
  const orderInfo = `Thanh toán đơn hàng #${order_id}`;
  const extraData = JSON.stringify({ order_id });

  const signData = {
    accessKey,
    amount,
    extraData,
    ipnUrl,
    orderId,
    orderInfo,
    partnerCode,
    redirectUrl: "http://localhost:5173/payment-result",
    requestId,
    requestType: "payWithMethod",
  };

  const signature = createHmac("sha256", secretKey)
    .update(createMoMoSignature(signData))
    .digest("hex");

  const body = {
    partnerCode: "MOMO",
    requestId,
    amount,
    orderId,
    orderInfo,
    redirectUrl: "http://localhost:5173/payment-result",
    ipnUrl,
    extraData,
    requestType: "payWithMethod",
    autoCapture: true,
    signature,
    lang: "vi",
  };

  const result = await axios.post(endpoint, body, {
    headers: { "Content-Type": "application/json" },
  });
  return result.data;
};
