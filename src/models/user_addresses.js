import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class user_addresses extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    address_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    receiver_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    address_detail: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    }
  }, {
    sequelize,
    tableName: 'user_addresses',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "user_addresses_pkey",
        unique: true,
        fields: [
          { name: "address_id" },
        ]
      },
    ]
  });
  }
}
