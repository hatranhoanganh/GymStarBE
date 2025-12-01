import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class order_details extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        order_detail_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        order_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "orders",
            key: "order_id",
          },
        },
        product_variant_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "product_variants",
            key: "product_variant_id",
          },
        },
        quantity: {
          type: DataTypes.INTEGER,
          allowNull: false,
          validate: { min: 1 },
        },
        price: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
      },
      {
        sequelize,
        tableName: "order_details",
        schema: "public",
        timestamps: false,
        indexes: [
          {
            name: "order_details_pkey",
            unique: true,
            fields: [{ name: "order_detail_id" }],
          },
        ],
      }
    );
  }
}
