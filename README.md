拿到项目 首先执行
npm insatll

然后新建.env文件 配置数据库 地址 如下 - 推荐是空表
DATABASE_URL="postgresql://postgres:123456@localhost:5432/slothvault"

然后 执行
npx prisma migrate dev --name init  初始化数据库配置
npx prisma generate                 生成并确认

然后启动 
npm run dev


如果修改数据表数据表修改 使用 下述指令 来 同步表结构
<name> 为 此次更改的 日期 方便溯源

npx prisma migrate dev --name <name>  
npx prisma generate
