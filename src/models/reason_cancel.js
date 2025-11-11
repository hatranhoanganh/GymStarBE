import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class reason_cancel extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    reason_cancel_id: {
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
    reason: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    canceled_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP')
    }
  }, {
    sequelize,
    tableName: 'reason_cancel',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "reason_cancel_pkey",
        unique: true,
        fields: [
          { name: "reason_cancel_id" },
        ]
      },
    ]
  });
  }
}
