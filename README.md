拿到项目 首先执行
npm insatll

然后新建.env文件 配置 数据库如下 - 推荐是空表
DATABASE_URL="postgresql://postgres:123456@localhost:5432/slothvault"

然后 执行
npx prisma migrate dev --name init
npx prisma generate

然后启动 
npm run dev


如果修改数据表数据表修改 使用 下述指令 来 同步表结构
npx prisma migrate dev --name <name>
npx prisma generate
