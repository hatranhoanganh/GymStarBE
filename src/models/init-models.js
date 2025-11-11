import _sequelize from "sequelize";
const DataTypes = _sequelize.DataTypes;
import _carts from  "./carts.js";
import _categories from  "./categories.js";
import _feedback_reply from  "./feedback_reply.js";
import _feedbacks from  "./feedbacks.js";
import _order_details from  "./order_details.js";
import _orders from  "./orders.js";
import _payments from  "./payments.js";
import _product_images from  "./product_images.js";
import _product_variants from  "./product_variants.js";
import _products from  "./products.js";
import _reason_cancel from  "./reason_cancel.js";
import _review_images from  "./review_images.js";
import _review_reply from  "./review_reply.js";
import _reviews from  "./reviews.js";
import _user_addresses from  "./user_addresses.js";
import _users from  "./users.js";

export default function initModels(sequelize) {
  const carts = _carts.init(sequelize, DataTypes);
  const categories = _categories.init(sequelize, DataTypes);
  const feedback_reply = _feedback_reply.init(sequelize, DataTypes);
  const feedbacks = _feedbacks.init(sequelize, DataTypes);
  const order_details = _order_details.init(sequelize, DataTypes);
  const orders = _orders.init(sequelize, DataTypes);
  const payments = _payments.init(sequelize, DataTypes);
  const product_images = _product_images.init(sequelize, DataTypes);
  const product_variants = _product_variants.init(sequelize, DataTypes);
  const products = _products.init(sequelize, DataTypes);
  const reason_cancel = _reason_cancel.init(sequelize, DataTypes);
  const review_images = _review_images.init(sequelize, DataTypes);
  const review_reply = _review_reply.init(sequelize, DataTypes);
  const reviews = _reviews.init(sequelize, DataTypes);
  const user_addresses = _user_addresses.init(sequelize, DataTypes);
  const users = _users.init(sequelize, DataTypes);

  categories.belongsTo(categories, { as: "parent", foreignKey: "parent_id"});
  categories.hasMany(categories, { as: "categories", foreignKey: "parent_id"});
  products.belongsTo(categories, { as: "category", foreignKey: "category_id"});
  categories.hasMany(products, { as: "products", foreignKey: "category_id"});
  feedback_reply.belongsTo(feedbacks, { as: "feedback", foreignKey: "feedback_id"});
  feedbacks.hasOne(feedback_reply, { as: "feedback_reply", foreignKey: "feedback_id"});
  reviews.belongsTo(order_details, { as: "order_detail", foreignKey: "order_detail_id"});
  order_details.hasMany(reviews, { as: "reviews", foreignKey: "order_detail_id"});
  order_details.belongsTo(orders, { as: "order", foreignKey: "order_id"});
  orders.hasMany(order_details, { as: "order_details", foreignKey: "order_id"});
  payments.belongsTo(orders, { as: "order", foreignKey: "order_id"});
  orders.hasMany(payments, { as: "payments", foreignKey: "order_id"});
  reason_cancel.belongsTo(orders, { as: "order", foreignKey: "order_id"});
  orders.hasMany(reason_cancel, { as: "reason_cancels", foreignKey: "order_id"});
  carts.belongsTo(product_variants, { as: "product_variant", foreignKey: "product_variant_id"});
  product_variants.hasMany(carts, { as: "carts", foreignKey: "product_variant_id"});
  order_details.belongsTo(product_variants, { as: "product_variant", foreignKey: "product_variant_id"});
  product_variants.hasMany(order_details, { as: "order_details", foreignKey: "product_variant_id"});
  product_images.belongsTo(product_variants, { as: "product_variant", foreignKey: "product_variant_id"});
  product_variants.hasMany(product_images, { as: "product_images", foreignKey: "product_variant_id"});
  product_variants.belongsTo(products, { as: "product", foreignKey: "product_id"});
  products.hasMany(product_variants, { as: "product_variants", foreignKey: "product_id"});
  review_images.belongsTo(reviews, { as: "review", foreignKey: "review_id"});
  reviews.hasMany(review_images, { as: "review_images", foreignKey: "review_id"});
  review_reply.belongsTo(reviews, { as: "review", foreignKey: "review_id"});
  reviews.hasOne(review_reply, { as: "review_reply", foreignKey: "review_id"});
  carts.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(carts, { as: "carts", foreignKey: "user_id"});
  feedback_reply.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(feedback_reply, { as: "feedback_replies", foreignKey: "user_id"});
  feedbacks.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(feedbacks, { as: "feedbacks", foreignKey: "user_id"});
  orders.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(orders, { as: "orders", foreignKey: "user_id"});
  review_reply.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(review_reply, { as: "review_replies", foreignKey: "user_id"});
  user_addresses.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(user_addresses, { as: "user_addresses", foreignKey: "user_id"});

  return {
    carts,
    categories,
    feedback_reply,
    feedbacks,
    order_details,
    orders,
    payments,
    product_images,
    product_variants,
    products,
    reason_cancel,
    review_images,
    review_reply,
    reviews,
    user_addresses,
    users,
  };
}
