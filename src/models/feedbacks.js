import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class feedbacks extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    feedback_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    type: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'feedbacks',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "feedbacks_pkey",
        unique: true,
        fields: [
          { name: "feedback_id" },
        ]
      },
    ]
  });
  }
}
