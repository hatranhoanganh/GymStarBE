import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class reviews extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    review_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    order_detail_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'order_details',
        key: 'order_detail_id'
      }
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_visible: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    }
  }, {
    sequelize,
    tableName: 'reviews',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "reviews_pkey",
        unique: true,
        fields: [
          { name: "review_id" },
        ]
      },
    ]
  });
  }
}
