const formatVNDateTime = (date) => {
  if (!date) return null;
  return new Date(date).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(',', ' -');
};
const formatVNDate = (date) => {
  if (!date) return null;
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};
const formatCartItem = (cartItem, userFullName) => {
  const variant = cartItem.product_variant;
  const product = variant.product;

  const discount = parseFloat(product?.discount || 0);
  const price = parseFloat(variant?.price || 0);
  const discountedPrice = price * (1 - discount / 100);

  return {
    cart_id: cartItem.cart_id,
    user_id: String(cartItem.user_id),
    full_name: userFullName || null,
    product_variant_id: cartItem.product_variant_id,
    product_name: product?.name || null,
    quantity: cartItem.quantity,
    variant: {
      color: variant?.color,
      size: variant?.size,
      price,
      discount,
      discountedPrice,
    },
    createdAt: formatVNDateTime(cartItem.createdAt),
    updatedAt: formatVNDateTime(cartItem.updatedAt),
  };
};
export { formatVNDateTime , formatVNDate, formatCartItem };