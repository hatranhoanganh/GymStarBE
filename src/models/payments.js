import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class payments extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    payment_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    order_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'orders',
        key: 'order_id'
      }
    },
    method: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    total: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    payment_date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: "pending"
    }
  }, {
    sequelize,
    tableName: 'payments',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "payments_pkey",
        unique: true,
        fields: [
          { name: "payment_id" },
        ]
      },
    ]
  });
  }
}
