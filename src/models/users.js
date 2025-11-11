// src/models/users.js
import _sequelize from 'sequelize';
const { Model, DataTypes } = _sequelize;

export default class users extends Model {
  static init(sequelize) {
    return super.init({
      user_id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true
      },
      full_name: {
        type: DataTypes.STRING(100),
        allowNull: false
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true  // ĐÃ SỬA: Tạo constraint UNIQUE thật trong DB
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      gender: {
        type: DataTypes.STRING(10),
        allowNull: true
      },
      birth_date: {
        type: DataTypes.DATEONLY,
        allowNull: true
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false
      },
      role: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "customer"
      }
    }, {
      sequelize,
      tableName: 'users',
      schema: 'public',
      timestamps: true,
      indexes: [
        {
          name: "users_pkey",
          unique: true,
          fields: [{ name: "user_id" }]
        }
      ]
    });
  }
}