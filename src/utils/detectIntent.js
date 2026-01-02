export function detectIntent(message) {
  const msg = message.toLowerCase();

  if (msg.includes("giá")) return "PRICE";
  if (msg.includes("size")) return "SIZE";
  if (msg.includes("màu")) return "COLOR";
  if (msg.includes("còn hàng") || msg.includes("tồn kho")) return "STOCK";
  if (msg.includes("khuyến mãi")) return "PROMOTION";
  if (msg.includes("đơn hàng")) return "ORDER";
  if (msg.includes("huỷ") || msg.includes("đổi trả")) return "RETURN";

  return "GENERAL";
}
    