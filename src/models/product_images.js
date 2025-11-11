import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class product_images extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    product_image_id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    product_variant_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'product_variants',
        key: 'product_variant_id'
      }
    },
    image: {
      type: DataTypes.STRING(255),
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'product_images',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "product_images_pkey",
        unique: true,
        fields: [
          { name: "product_image_id" },
        ]
      },
    ]
  });
  }
}
