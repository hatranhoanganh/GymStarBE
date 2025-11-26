// src/models/roles.js
import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class roles extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      role_id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        field: 'role_id',
      },
      role_name: {
        type: DataTypes.STRING(20),
        allowNull: false,
        unique: true,
        field: 'role_name',
      },
    }, {
      sequelize,
      tableName: 'roles',
      schema: 'public',
      timestamps: false,  
    });
  }
}
