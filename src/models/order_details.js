import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class order_details extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    order_detail_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    order_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'orders',
        key: 'order_id'
      }
    },
    product_variant_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'product_variants',
        key: 'product_variant_id'
      }
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    price: {
      type: DataTypes.DECIMAL,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'order_details',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "order_details_pkey",
        unique: true,
        fields: [
          { name: "order_detail_id" },
        ]
      },
    ]
  });
  }
}
