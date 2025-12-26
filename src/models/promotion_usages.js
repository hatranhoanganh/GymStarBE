import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class promotion_usages extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        promotion_usage_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        promotion_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "promotions",
            key: "promotion_id",
          },
        },
        order_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true,
          references: {
            model: "orders",
            key: "order_id",
          },
        },
        used_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      },
      {
        sequelize,
        tableName: "promotion_usages",
        schema: "public",
        timestamps: false,
        indexes: [
          {
            name: "promotion_usages_pkey",
            unique: true,
            fields: [{ name: "promotion_usage_id" }],
          },
        ],
      }
    );
  }
}
