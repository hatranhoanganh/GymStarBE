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
const formatCartItem = (cartItem) => {
  const user = cartItem.user;
  const role = user?.role;
  const variant = cartItem.product_variant;
  const product = variant?.product;

  const price = parseFloat(product?.price || 0);
  const discount = parseFloat(product?.discount || 0);
  const discountedPrice = price * (1 - discount / 100);

  return {
    cart_id: cartItem.cart_id,

    // USER
    user_id: user?.user_id,
    full_name: user?.full_name,
    email: user?.email,
    gender: user?.gender,
    birth_date: formatVNDate(user?.birth_date),
    user_status: user?.status,
    role_id: user?.role_id,
    role_name: role?.role_name,

    // PRODUCT
    product_id: product?.product_id,
    product_name: product?.name,
    thumbnail: product?.thumbnail,
    price,
    discount,
    discountedPrice,

    // VARIANT
    product_variant_id: variant?.product_variant_id,
    color: variant?.color,
    size: variant?.size,
    stock: variant?.stock,

    // CART
    quantity: cartItem.quantity,
    createdAt: formatVNDateTime(cartItem.createdAt),
    updatedAt: formatVNDateTime(cartItem.updatedAt),
  };
};




export { formatVNDateTime , formatVNDate, formatCartItem };