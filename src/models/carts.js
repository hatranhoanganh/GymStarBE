import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class carts extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    cart_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'user_id'
      },
      unique: "carts_user_id_product_variant_id_key"
    },
    product_variant_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'product_variants',
        key: 'product_variant_id'
      },
      unique: "carts_user_id_product_variant_id_key"
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    }
  }, {
    sequelize,
    tableName: 'carts',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "carts_pkey",
        unique: true,
        fields: [
          { name: "cart_id" },
        ]
      },
      {
        name: "carts_user_id_product_variant_id_key",
        unique: true,
        fields: [
          { name: "user_id" },
          { name: "product_variant_id" },
        ]
      },
    ]
  });
  }
}
