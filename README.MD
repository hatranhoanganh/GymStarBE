cách setup source chạy back end

------------------B1: npm init
------------------B1.1: npm nodemon (lib tự động restart sever mỗi khi save)
------------------B1.2:cấu hình package.json( thêm type:module và đổi start thành nodemon index.js)
------------------B2: npm i dotenv (lib để tải các biến môi trường từ file .env)
------------------B3: npm i express (lib để code api backend (get ,post ,delete , put ))
------------------B4: tạo file index.js (file để chạy code)
// Chạy backend
// import thư viện
import express from "express";
import rootRoutes from "./src/routes/root.router.js";
import cors from "cors";

// tạo đối tượng
const app = express();
app.use(express.json());

app.use(cors());

app.get("/", (req, res) => {
res.send("CHao dang gia bao ");
});

app.use(rootRoutes);

// define port để BE chạy
app.listen(8081, () => {
console.log("Sever online with port 8081");
});
{(dùng cho mysql)------------------B5: npm i sequelize sequelize-auto (lib giúp làm việc với db)
------------------B6: npm mysql2
------------------B7: npx sequelize-auto -h localhost -d khoa_hoc -u root -x 123456 -p 3308 --dialect mysql -o src/models -l esm (link với db)
npx sequelize-auto -h localhost -d shopquanao -u root -x  -p 3306 --dialect mysql -o src/models -l esm (tạo nhiều file trong model)
npx sequelize-auto -h localhost -d shopquanao -u root -x  -p 3306 --dialect mysql -o src/models -l esm -t gallery(tạo 1 file bất kì trong model , ví dụ ở đây là tạo bảng gallery)
npx sequelize-auto -h sql207.byethost24.com -d b24_37795256_khoa_hoc -u b24_37795256 -x 0988925891Bb --dialect mysql -o src/models -l esm
}
{(dùng cho postgreSQL)
npx sequelize-auto -h localhost -d gymstar -u postgres -x 123456 -p 5433 --dialect postgres -o src/models -l esm (link với db)
}


(link với data base có:
-localhost:localhost
-database: youtube_mini
-user:root,
-pass:123456,
-port:3307,
-dialect:mysql
)  
------------------B8: tạo file .env và thêm
DB_PORT=3308
DB_USERNAME=root
DB_PASS=123456
DB_HOST=localhost
DB_DATABASE=appfood
DB_DIALECT=mysql
EMAIL_USER=summonann@gmail.com
EMAIL_PASS=kxrc ccyh bqit ogja
JWT_KEY=NODE_44
REFRESH_SECRET=NODE_44_REFRESH  
B: tạo file connect.js trong folder models và thêm :
import {Sequelize} from 'sequelize';
import configDb from '../config/connect_db.js'

                        const sequelize = new Sequelize(
                        configDb.database, //tên database
                        configDb.user, // ten user
                        configDb.pass, //password user
                        {
                            host: configDb.host,
                            port: configDb.port,
                            dialect: configDb.dialect
                        }
                         )

                        export default sequelize;

------------------B9: Tạo 3 thư mục config,controller,models trong thư mục src

------------------B10: Trong folder config , tạo file connect_db.js và thêm
import dotenv from "dotenv";
// Nạp các biến môi trường từ file .env
dotenv.config();

                        export default {
                        database: process.env.DB_DATABASE,
                        user: process.env.DB_USERNAME,
                        pass: process.env.DB_PASS,
                        host: process.env.DB_HOST,
                        port: process.env.DB_PORT,
                        dialect: process.env.DB_DIALECT,
                        };

------------------B11:lên post man tạo request mới với urt http://localhost:8080/
------------------B12:code routes và controller
------------------Đẩy lại code mới lên github : git add .
                                                git commit -m "change some texts"
                                                git push origin master