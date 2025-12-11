import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class carts extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        cart_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true, 
          references: {
            model: "users",
            key: "user_id",
          },
        },
      },
      {
        sequelize,
        tableName: "carts",
        schema: "public",
        timestamps: false, 
        underscored: true,
      }
    );
  }

 
}
