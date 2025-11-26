// src/models/users.js
import _sequelize from 'sequelize';
const { Model, DataTypes } = _sequelize;

export default class users extends Model {
  static init(sequelize) {
    return super.init({
      // 1. user_id → dùng field để map
      user_id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        field: 'user_id'  // DB: user_id → code: userId (tùy chọn)
      },
      full_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        field: 'full_name'
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        field: 'email'
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: 'password'
      },
      gender: {
        type: DataTypes.STRING(10),
        allowNull: true,
        field: 'gender'
      },
      birth_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: 'birth_date'  // QUAN TRỌNG: map birthDate ↔ birth_date
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "unverified",
        field: 'status'
      },
      role_id: {
  type: DataTypes.INTEGER,
  allowNull: true,          // hoặc false nếu bạn bắt buộc user phải có role
  field: 'role_id'
},
    }, {
      sequelize,
      tableName: 'users',
      schema: 'public',
      timestamps: true,
      underscored: true,  // TỰ ĐỘNG: createdAt → created_at
      indexes: [
        {
          name: "users_pkey",
          unique: true,
          fields: [{ name: "user_id" }]
        },
        {
          name: "users_email_key",
          unique: true,
          fields: [{ name: "email" }]
        }
      ]
    });
  } 

 
  
  
}
