# Nuxt → Next.js 迁移矩阵

本文记录当前仓库中已启用的 Next.js 实现与保留的 Nuxt 参考实现之间的对应关系。运行时入口、页面、API、上传存储和容器启动均以 `src/`、`.next/standalone` 与 `APP_DATA_PATH` 为准。

## 迁移概览

| 范围 | Nuxt/Vue | Next.js/React | 当前状态 |
| --- | --- | --- | --- |
| 页面 | `app/pages/**/*.vue` | `src/app/**/page.tsx`（23 个页面，含 `/install` 与 `/maintenance`） | 已迁移并增加首次安装门禁 |
| API | `server/api/**/*.ts`（56 个 URL、80 个方法） | `src/app/api/**/route.ts`（64 个 URL、88 个方法） | 已迁移；新增会话、退出、语言偏好与数据库安装 |
| 上传访问 | `public/uploads` 静态暴露 | `/uploads/[...path]` GET/HEAD + `APP_DATA_PATH/uploads` | 已迁移并收紧路径安全 |
| 管理 UI | Vue + Element Plus | React + Ant Design + TanStack Query | 已迁移 |
| 状态与主题 | Pinia / Nuxt i18n | Zustand / next-themes / next-intl | 已迁移 |
| Markdown | Nuxt 编辑器组件 | `@uiw/react-md-editor` + `react-markdown` | 已迁移 |
| 钱包 | Vue Wallet Adapter | Solana Wallet Adapter React | 已迁移 |
| 部署 | Nitro `.output` | Next standalone `server.js` | 已迁移 |
| 数据库 | PostgreSQL 四 schema、启动前迁移 | SQLite/MySQL/PostgreSQL 空库网页安装、扁平表 | 已重构为 provider-neutral 安装 |
| 旧实现 | 根目录 Nuxt 源文件 | `legacy-nuxt/app/` 与旧 `server/` | 仅作核对参考，尚未删除 |

Next 版本额外提供：

- `GET /api/admin/auth/session`
- `POST /api/admin/auth/logout`
- `POST /api/preferences/locale`
- `GET /api/install/status`
- `POST /api/install/test-connection`
- `POST /api/install/initialize`
- `POST /api/install/admin`
- `POST /api/install/reset`
- `GET|HEAD /uploads/[...path]`（不计入上表的 `/api` 统计）

## 页面对应关系

| 功能 | Next.js 页面 |
| --- | --- |
| 系统首页 | `/` |
| 项目列表 | `/project/projectList` |
| 项目入口、首页与文档入口 | `/project/[id]`、`/project/[id]/home`、`/project/[id]/docs` |
| 版本文档与正文阅读 | `/project/[id]/v/[versionId]/docs`、`/project/[id]/v/[versionId]/docs/[noteId]` |
| 系统安装与维护 | `/install`、`/maintenance` |
| 管理入口、旧初始化跳转与登录 | `/admin`、`/admin/auth/init`、`/admin/auth/login` |
| 管理仪表盘 | `/admin/mm` |
| 项目与项目首页 | `/admin/mm/projects`、`/admin/mm/projects/[id]/home` |
| 分类、笔记与内容版本 | `/admin/mm/categories`、`/admin/mm/notes`、`/admin/mm/notes/[id]/content` |
| 文件、系统首页与配置 | `/admin/mm/files`、`/admin/mm/homepage`、`/admin/mm/settings` |
| 备份恢复 | `/admin/mm/backup` |
| Solana | `/admin/mm/solana`（合并旧 trees/cNFT 子页面与弹窗） |

## Next API 矩阵

| URL | 方法 |
| --- | --- |
| `/api/admin/auth/check` | `GET` |
| `/api/admin/auth/init` | `POST` |
| `/api/admin/auth/login` | `POST` |
| `/api/admin/auth/logout` | `POST` |
| `/api/admin/auth/session` | `GET` |
| `/api/install/admin` | `POST` |
| `/api/install/initialize` | `POST` |
| `/api/install/reset` | `POST` |
| `/api/install/status` | `GET` |
| `/api/install/test-connection` | `POST` |
| `/api/admin/mm/backup/database-export` | `GET` |
| `/api/admin/mm/backup/database-import` | `POST` |
| `/api/admin/mm/backup/files-export` | `GET` |
| `/api/admin/mm/backup/files-import` | `POST` |
| `/api/admin/mm/backup/system-reset` | `POST` |
| `/api/admin/mm/category` | `GET`, `POST` |
| `/api/admin/mm/category/[id]` | `PUT`, `DELETE` |
| `/api/admin/mm/category/byProjectVersion/[projectVersionId]` | `GET` |
| `/api/admin/mm/config` | `GET`, `PUT` |
| `/api/admin/mm/config/refresh` | `POST` |
| `/api/admin/mm/dashboard` | `GET` |
| `/api/admin/mm/file` | `GET`, `POST` |
| `/api/admin/mm/file/[id]` | `GET`, `PUT`, `DELETE` |
| `/api/admin/mm/file/batch` | `POST` |
| `/api/admin/mm/home` | `GET`, `POST` |
| `/api/admin/mm/home/[id]` | `GET`, `PUT`, `DELETE` |
| `/api/admin/mm/menu` | `GET`, `POST` |
| `/api/admin/mm/menu/[id]` | `GET`, `PUT`, `DELETE` |
| `/api/admin/mm/note` | `GET`, `POST` |
| `/api/admin/mm/note/[id]` | `GET`, `PUT`, `DELETE` |
| `/api/admin/mm/noteContent` | `GET`, `POST` |
| `/api/admin/mm/noteContent/[id]` | `PUT`, `DELETE` |
| `/api/admin/mm/project` | `GET`, `POST` |
| `/api/admin/mm/project/[id]` | `GET`, `PUT`, `DELETE` |
| `/api/admin/mm/project/avatar` | `POST` |
| `/api/admin/mm/project/batch` | `POST` |
| `/api/admin/mm/projectVersion` | `GET`, `POST` |
| `/api/admin/mm/projectVersion/[id]` | `PUT`, `DELETE` |
| `/api/admin/mm/projectVersion/batch` | `POST` |
| `/api/admin/mm/projectVersion/byProject/[projectId]` | `GET` |
| `/api/admin/mm/systemHomepage` | `GET`, `POST` |
| `/api/admin/mm/systemHomepage/[id]` | `PUT` |
| `/api/admin/solana/cnft` | `GET` |
| `/api/admin/solana/cnft/[id]` | `DELETE` |
| `/api/admin/solana/cnft/prepare` | `POST` |
| `/api/admin/solana/cnft/submit` | `POST` |
| `/api/admin/solana/config` | `GET`, `PUT` |
| `/api/admin/solana/tree` | `GET` |
| `/api/admin/solana/tree/[id]` | `DELETE` |
| `/api/admin/solana/tree/[id]/verify` | `POST` |
| `/api/admin/solana/tree/estimate` | `POST` |
| `/api/admin/solana/tree/prepare` | `POST` |
| `/api/admin/solana/tree/submit` | `POST` |
| `/api/homepage` | `GET` |
| `/api/preferences/locale` | `POST` |
| `/api/project/[id]` | `GET` |
| `/api/project/[id]/home` | `GET` |
| `/api/project/[id]/menu` | `GET` |
| `/api/project/[id]/v/[versionId]/note/[noteId]` | `GET` |
| `/api/project/[id]/v/[versionId]/sidebar` | `GET` |
| `/api/project/[id]/verify-access` | `POST` |
| `/api/project/[id]/versions` | `GET` |
| `/api/project/list` | `GET` |
| `/api/solana/balance` | `GET` |

## 迁移中完成的行为修正

- 管理 API 统一使用数据库会话守卫，Cookie 仅保存随机令牌，数据库只保存 SHA-256 哈希。
- 项目阅读权限已简化为公开访问；原 `/verify-access` 端点仅保留兼容响应，不再校验钱包或 cNFT。
- 新增普通用户注册、密码登录、可选钱包地址登录、个人主页、积分流水和卡密兑换；管理员角色是唯一内容发布权限。
- NoteContent 写入通过递增父记录 revision 获得可移植的事务写边界，再归一化唯一主版本。
- 上传文件移出 `public/`，服务端执行路径 containment、文件类型/体积和 Sharp 解码校验。
- 数据库导出按 provider 选择一致性事务并生成关系闭包，恢复在单一事务内完成；ZIP 恢复先完整校验并解压到 staging，再提交或回滚。
- Route Handler 使用进程级读写协调：读取可并行，写入串行，文件导出锁保持到 ZIP 流关闭。
- Solana prepare/submit 会话改为 5 分钟加密 HMAC 令牌；submit 校验消息哈希、fee payer、程序、树/owner 和全部签名。
- cNFT prepare 使用条件原子更新预留树容量；submit 广播前持久化确定性签名和有效区块高度，confirmed 后解析 SPL Account Compression change log，以链上真实 leaf 生成 asset ID。
- cNFT pending attempt 可在 session 过期后按签名自动对账；失败保留 `pending_*` 占位 ID，只有终结失败记录允许删除。
- Filebase 和 Solana 配置每次从当前 provider 数据库读取，避免多进程缓存不一致。
- 数据库连接改为 AES-256-GCM 加密落盘，启动时不接受 `DATABASE_URL` 绕过 `/install`。
- 三种 provider 维护等价 schema、独立 Prisma Client 与版本化迁移；新 PostgreSQL 安装不再使用旧四-schema 布局。

## 验证状态

默认检查：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run prisma:validate
```

已确认：

- 迁移前的 PostgreSQL/Docker 隔离环境已验证 14 个旧迁移、Session 有效/过期/撤销、管理 CRUD、公开读取、上传与 ZIP 恢复、数据库 overwrite/reset/恢复、双 Next 实例并发和 PostgreSQL 行锁阻塞；这些结果不替代三 provider 新安装矩阵；
- Node 22 Alpine 多阶段生产镜像可以从锁文件执行 `npm ci` 并完成 Next standalone 构建；
- `/app/data/uploads` 旧挂载方案已通过两个独立容器的写入、销毁和重新读取验证；新部署进一步拆分 `config`、`database` 与 `uploads` 卷；
- Filebase 服务使用真实 AWS SDK HTTP 请求完成本地 S3 兼容协议 smoke，覆盖 PUT/HEAD/DELETE、CID header、对象 key 和错误处理；
- Solana devnet 真实 RPC 只读 smoke 已连接当前 Bubblegum 程序，从 MintV1/MintV2/MintToCollection 交易的 SPL Noop change log 解析真实 tree/leaf；
- cNFT 本地测试覆盖逆序确认、失败、pending 和歧义 change log，最终 asset 身份不依赖 prepare 顺序。

显式 opt-in 测试：

```bash
RUN_FILEBASE_S3_SMOKE=1 npx vitest run src/server/services/filebase.test.ts
RUN_SOLANA_DEVNET_SMOKE=1 npx vitest run src/server/services/solana-devnet.integration.test.ts
```

仍依赖授权或真实凭据的验证：

- Solana devnet 的树创建、cNFT mint/broadcast 和 DAS 持有权查询；
- 使用真实 Filebase Access Key/Secret/Bucket 的 S3/IPFS 上传；
- mainnet 写入刻意未执行，必须单独授权。

多数据库重构交付前还必须在隔离环境完成 SQLite、MySQL 与 PostgreSQL 的空库安装、非空库拒绝、管理员唯一性、CRUD、Session、逻辑备份恢复和并发契约测试；不得使用当前现役 PostgreSQL 作为测试目标。

旧 Nuxt 目录暂不删除。清理 `legacy-nuxt/`、旧 `server/` 和其他 Nuxt 配置属于不可逆范围，需在上述剩余验证完成后单独授权。
