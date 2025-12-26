import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class promotions extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        promotion_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        code: {
          type: DataTypes.STRING(30),
          allowNull: false,
          unique: true,
        },
        value: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        min_order_value: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          defaultValue: 0,
        },
        discount_type: {
          type: DataTypes.STRING(10),
          allowNull: false,
          validate: {
            isIn: [["fixed", "percent"]],
          },
        },
        max_discount: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
        },
        start_date: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        end_date: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        usage_per_user: {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: "active",
          validate: {
            isIn: [["active", "inactive"]],
          },
        },
      },
      {
        sequelize,
        tableName: "promotions",
        schema: "public",
        timestamps: false,
        indexes: [
          {
            name: "promotions_pkey",
            unique: true,
            fields: [{ name: "promotion_id" }],
          },
        ],
      }
    );
  }
}
