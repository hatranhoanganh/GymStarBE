import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class products extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        product_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        category_id: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: "categories",
            key: "category_id",
          },
        },
        name: {
          type: DataTypes.STRING(255),
          allowNull: false,
        },
        description: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        discount: {
          type: DataTypes.DECIMAL,
          allowNull: true,
          defaultValue: 0,
        },
        status: {
          type: DataTypes.STRING(20),
          allowNull: false,
          defaultValue: "active",
        },
        thumbnail: {
          type: DataTypes.STRING(255),
          allowNull: true,
        },
        spec: {
          type: DataTypes.JSONB,
          allowNull: true,
        },
      },
      {
        sequelize,
        tableName: "products",
        schema: "public",
        timestamps: true,
        underscored: true,
        indexes: [
          {
            name: "products_pkey",
            unique: true,
            fields: [{ name: "product_id" }],
          },
        ],
      }
    );
  }
}
