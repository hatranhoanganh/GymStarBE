import _sequelize from "sequelize";
const { Model, Sequelize } = _sequelize;

export default class reason_cancel extends Model {
  static init(sequelize, DataTypes) {
    return super.init(
      {
        reason_cancel_id: {
          autoIncrement: true,
          type: DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        order_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          unique: true,
          references: {
            model: "orders",
            key: "order_id",
          },
        },
        reason: {
          type: DataTypes.STRING(100),
          allowNull: false,
          validate: {
            isIn: {
              args: [
                [
                  "Đổi ý không muốn mua nữa",
                  "Đặt nhầm sản phẩm/màu/size",
                  "Tìm được chỗ khác rẻ hơn",
                  "Thay đổi địa chỉ giao hàng",
                  "Giao hàng quá lâu",
                  "Muốn thay đổi phương thức thanh toán",
                ],
              ],
              msg: "Lý do hủy không hợp lệ",
            },
          },  
        },
        canceled_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
        },
      },
      {
        sequelize,
        tableName: "reason_cancel",
        schema: "public",
        timestamps: false,
        indexes: [
          {
            name: "reason_cancel_pkey",
            unique: true,
            fields: [
              { name: "reason_cancel_id" },
              {
                name: "reason_cancel_order_id_key",
                unique: true,
                fields: ["order_id"],
              },
            ],
          },
        ],
      }
    );
  }
}
