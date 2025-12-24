import dotenv from "dotenv";
import sequelize from "../config/database.js";
import initModels from "../models/init-models.js";
import axios from "axios";
import cron from "node-cron"; 
import { Op } from "sequelize";
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

cron.schedule("* * * * *", async () => {
  const now = new Date();
  const expiredOrders = await model.orders.findAll({
    where: {
      status: "chờ xác nhận", 
      order_date: { [Op.lt]: new Date(now - 15 * 60 * 1000) }
    },
    include: [
      {
        model: model.payments,
        as: "payment", 
        where: {
          method: "MOMO",
          status: { [Op.not]: "thành công" }
        },
        required: true
      }
    ]
  });

  for (const order of expiredOrders) {
    await cancelOrderAndRestoreStock(order.order_id);
    console.log(`Đơn MoMo #${order.order_id} quá hạn 15 phút → đã hủy và hoàn stock`);
  }
});


const createMoMoSignature = (params) => {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
};




export const handlePaymentRequest = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: "Thiếu order_id" });

    const order = await model.orders.findOne({ where: { order_id } });
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

   
    const expiredAt = new Date(order.order_date.getTime() + 15 * 60 * 1000);
    if (new Date() > expiredAt) {
      return res.status(400).json({
        message: "Đơn hàng đã hết hạn thanh toán",
        expired: true,
      });
    }

    const amount = Math.round(Number(order.total)).toString();
    const momo_order_id = `${order_id}_${Date.now()}`;
    const requestId = momo_order_id;
    const orderInfo = `Thanh toán đơn hàng #${order_id}`;
    const extraData = JSON.stringify({ order_id });

   
    await model.payments.create(
      {
        order_id,
        momo_order_id,
        method: "MOMO",
        amount: order.total,
        total: order.total,
        status: "đang chờ",
      },
      { transaction: t }
    );

   
    const signData = {
      accessKey,
      amount,
      extraData,
      ipnUrl,
      orderId: momo_order_id,
      orderInfo,
      partnerCode,
      redirectUrl: `http://localhost:5173/dat-hang-thanh-cong/${order_id}`,
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
      orderId: momo_order_id,
      orderInfo,
      redirectUrl: `http://localhost:5173/dat-hang-thanh-cong/${order_id}`,
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

    // 1. Lấy chi tiết đơn (lock)
    const details = await model.order_details.findAll({
      where: { order_id },
      attributes: ["product_variant_id", "quantity"],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // 2. Hoàn stock
    for (const item of details) {
      await model.product_variants.increment("stock", {
        by: item.quantity,
        where: { product_variant_id: item.product_variant_id },
        transaction: t,
      });
    }

    // 3. Update payment → thất bại (chỉ khi chưa thành công)
    await model.payments.update(
      {
        status: "thất bại",
      },
      {
        where: {
          order_id,
          status: { [Op.ne]: "thành công" },
        },
        transaction: t,
      }
    );

    // 4. Update order → đã hủy
    await model.orders.update(
      { status: "đã hủy" },
      { where: { order_id }, transaction: t }
    );

    await t.commit();
    console.log(`Đơn #${order_id} → đã hủy + hoàn stock (KHÔNG xóa dữ liệu)`);
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    console.error(`Lỗi hủy đơn #${order_id}:`, err);
  }
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

    
    const payments = await model.payments.findAll({
      where: { order_id, method: "MOMO" },
      order: [["payment_id", "DESC"]],
    });

    const payment = payments.find(p => p.status !== "thành công");
    if (!payment) return res.status(404).json({ message: "Không tìm thấy payment chưa thành công" });

    if (resultCode == 0) {
      await payment.update({
        status: "thành công",
        payment_date: new Date(Number(responseTime)), 
        trans_id: transId?.toString(),
      });
    } else {
      await payment.update({
        status: "thất bại",
        payment_date: null, 
      });
    }

    return res.json({ resultCode: 0, message: "OK" });
  } catch (error) {
    console.error("Lỗi IPN MoMo:", error);
    return res.status(500).json({ message: "Server error" });
  }
};


export const retryPayment = async (req, res) => {
  try {
    const { order_id } = req.body;
    if (!order_id) return res.status(400).json({ message: "Thiếu order_id" });

    const order = await model.orders.findOne({ where: { order_id } });
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });

    if (order.status === "đã hủy")
      return res.status(400).json({ message: "Đơn hàng đã bị hủy" });


    const expiredAt = new Date(order.order_date.getTime() + 15 * 60 * 1000);
    if (new Date() > expiredAt) {
      return res.status(400).json({ message: "Đơn hàng đã hết hạn thanh toán" });
    }

    
    const newPayment = await model.payments.create({
      order_id,
      method: "MOMO",
      amount: order.total,
      total: order.total,
      status: "đang chờ",
      payment_date: null, 
    });

  
    const momoData = await prepareMomoPayment(order_id);

    return res.json({
      message: "Tạo link thanh toán lại thành công",
      payUrl: momoData.payUrl,
      order_id,
    });
  } catch (error) {
    console.error("retryPayment error:", error);
    return res.status(500).json({ message: "Lỗi server" });
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
    redirectUrl: `http://localhost:5173/dat-hang-thanh-cong/${order_id}`,
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
    redirectUrl: `http://localhost:5173/dat-hang-thanh-cong/${order_id}`,
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
