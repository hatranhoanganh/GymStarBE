import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class cart_details extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        cart_detail_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        cart_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "carts",
            key: "cart_id",
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
          defaultValue: 1,
          validate: { min: 1 },
        },
      },
      {
        sequelize,
        tableName: "cart_details",
        schema: "public",
        timestamps: false,
        underscored: true,
        indexes: [
          {
            name: "cart_details_cart_id_product_variant_id_key",
            unique: true,
            fields: [{ name: "cart_id" }, { name: "product_variant_id" }],
          },
        ],
      }
    );
  }

 
}
