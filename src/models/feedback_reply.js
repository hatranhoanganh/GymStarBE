import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class feedback_reply extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    feedback_reply_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    feedback_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'feedbacks',
        key: 'feedback_id'
      },
      unique: "feedback_reply_feedback_id_key"
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'user_id'
      }
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    replied_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('now')
    }
  }, {
    sequelize,
    tableName: 'feedback_reply',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "feedback_reply_feedback_id_key",
        unique: true,
        fields: [
          { name: "feedback_id" },
        ]
      },
      {
        name: "feedback_reply_pkey",
        unique: true,
        fields: [
          { name: "feedback_reply_id" },
        ]
      },
    ]
  });
  }
}
