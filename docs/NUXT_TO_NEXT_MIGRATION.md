# Nuxt → Next.js 迁移矩阵

本文记录当前仓库中已启用的 Next.js 实现与保留的 Nuxt 参考实现之间的对应关系。运行时入口、页面、API、上传存储和容器启动均以 `src/`、`.next/standalone` 与 `data/uploads` 为准。

## 迁移概览

| 范围 | Nuxt/Vue | Next.js/React | 当前状态 |
| --- | --- | --- | --- |
| 页面 | `app/pages/**/*.vue` | `src/app/**/page.tsx`（21 个页面） | 已迁移 |
| API | `server/api/**/*.ts`（56 个 URL、80 个方法） | `src/app/api/**/route.ts`（59 个 URL、83 个方法） | 已迁移；新增会话、退出、语言偏好 |
| 上传访问 | `public/uploads` 静态暴露 | `/uploads/[...path]` GET/HEAD + `data/uploads` | 已迁移并收紧路径安全 |
| 管理 UI | Vue + Element Plus | React + Ant Design + TanStack Query | 已迁移 |
| 状态与主题 | Pinia / Nuxt i18n | Zustand / next-themes / next-intl | 已迁移 |
| Markdown | Nuxt 编辑器组件 | `@uiw/react-md-editor` + `react-markdown` | 已迁移 |
| 钱包 | Vue Wallet Adapter | Solana Wallet Adapter React | 已迁移 |
| 部署 | Nitro `.output` | Next standalone `server.js` | 已迁移 |
| 旧实现 | 根目录 Nuxt 源文件 | `legacy-nuxt/app/` 与旧 `server/` | 仅作核对参考，尚未删除 |

Next 版本额外提供：

- `GET /api/admin/auth/session`
- `POST /api/admin/auth/logout`
- `POST /api/preferences/locale`
- `GET|HEAD /uploads/[...path]`（不计入上表的 `/api` 统计）

## 页面对应关系

| 功能 | Next.js 页面 |
| --- | --- |
| 系统首页 | `/` |
| 项目列表 | `/project/projectList` |
| 项目入口、首页与文档入口 | `/project/[id]`、`/project/[id]/home`、`/project/[id]/docs` |
| 版本文档与正文阅读 | `/project/[id]/v/[versionId]/docs`、`/project/[id]/v/[versionId]/docs/[noteId]` |
| 管理入口、初始化与登录 | `/admin`、`/admin/auth/init`、`/admin/auth/login` |
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
- 项目钱包访问证明改为短期 Ed25519 签名，不再只接受调用方声明的钱包地址。
- NoteContent 主版本切换使用 PostgreSQL 行锁和 Prisma 事务。
- 上传文件移出 `public/`，服务端执行路径 containment、文件类型/体积和 Sharp 解码校验。
- 数据库导出使用 `REPEATABLE READ` 关系闭包快照，恢复在单一事务内完成；ZIP 恢复先完整校验并解压到 staging，再提交或回滚。
- Route Handler 使用进程级读写协调：读取可并行，写入串行，文件导出锁保持到 ZIP 流关闭。
- Solana prepare/submit 会话改为 5 分钟加密 HMAC 令牌；submit 校验消息哈希、fee payer、程序、树/owner 和全部签名。
- cNFT prepare 仅锁树并预留容量；submit 广播前持久化确定性签名和有效区块高度，confirmed 后解析 SPL Account Compression change log，以链上真实 leaf 生成 asset ID。
- cNFT pending attempt 可在 session 过期后按签名自动对账；失败保留 `pending_*` 占位 ID，只有终结失败记录允许删除。
- Filebase 和 Solana 配置每次从 PostgreSQL 读取，避免多进程缓存不一致。

## 验证状态

默认检查：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx prisma validate
```

已确认：

- 真实 PostgreSQL/Docker 隔离环境已验证 14 个迁移、Session 有效/过期/撤销、管理 CRUD、公开读取、上传与 ZIP 恢复、数据库 overwrite/reset/恢复、双 Next 实例并发和 PostgreSQL 行锁阻塞；
- Node 22 Alpine 多阶段生产镜像可以从锁文件执行 `npm ci` 并完成 Next standalone 构建；
- `/app/data/uploads` 挂载已通过两个独立容器的写入、销毁和重新读取验证；
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

旧 Nuxt 目录暂不删除。清理 `legacy-nuxt/`、旧 `server/` 和其他 Nuxt 配置属于不可逆范围，需在上述剩余验证完成后单独授权。
