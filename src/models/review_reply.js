import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class review_reply extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    review_reply_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    review_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'reviews',
        key: 'review_id'
      },
      unique: "review_reply_review_id_key"
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
    tableName: 'review_reply',
    schema: 'public',
    timestamps: false,
    indexes: [
      {
        name: "review_reply_pkey",
        unique: true,
        fields: [
          { name: "review_reply_id" },
        ]
      },
      {
        name: "review_reply_review_id_key",
        unique: true,
        fields: [
          { name: "review_id" },
        ]
      },
    ]
  });
  }
}
