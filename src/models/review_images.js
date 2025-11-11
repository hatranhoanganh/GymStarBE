import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class review_images extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    review_image_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    review_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'reviews',
        key: 'review_id'
      }
    },
    image: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    is_visible: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    }
  }, {
    sequelize,
    tableName: 'review_images',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "review_images_pkey",
        unique: true,
        fields: [
          { name: "review_image_id" },
        ]
      },
    ]
  });
  }
}
