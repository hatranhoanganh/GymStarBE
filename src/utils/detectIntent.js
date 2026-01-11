export function detectIntent(message) {
  const msg = message.toLowerCase();


   if (
  msg.includes("khuyến mãi") ||
  msg.includes("mã giảm") ||
  msg.includes("mã giảm giá") ||
  msg.includes("voucher") ||
  msg.includes("code") ||
  msg.includes("coupon")
) {
  return "PROMOTION";
}
  if (
    msg.includes("bao lâu") ||
    msg.includes("khi nào nhận") ||
    msg.includes("mấy ngày") ||
    msg.includes("thời gian giao") ||
    msg.includes("nhận được hàng")
  ) {
    return "DELIVERY_TIME";
  }


  if (
    msg.includes("ship") ||
    msg.includes("vận chuyển") ||
    msg.includes("giao hàng")
  ) {
    return "SHIPPING";
  }


  if (msg.includes("đổi") || msg.includes("trả")) return "RETURN";
  if (msg.includes("huỷ") || msg.includes("hủy")) return "CANCEL";

 
  if (
    msg.includes("bán chạy") ||
    msg.includes("mua nhiều") ||
    msg.includes("hot") ||
    msg.includes("best seller")
  ) {
    return "BEST_SELLER";
  }


  if (msg.includes("giá")) return "PRICE";


  if (msg.includes("size")) return "SIZE";
  if (msg.includes("màu")) return "COLOR";
  if (msg.includes("còn hàng") || msg.includes("tồn kho")) return "STOCK";

  
 


 
  if (msg.includes("đơn hàng")) return "ORDER";

  return "GENERAL";
}
