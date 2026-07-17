<div align="center">
  <img src="public/logo.png" alt="SlothVault logo" width="150" />

# SlothVault

基于 Next.js、PostgreSQL 与 Solana cNFT 的多项目 Markdown 文档系统。

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Solana](https://img.shields.io/badge/Solana-cNFT-14F195?logo=solana&logoColor=black)](https://solana.com/)

</div>

当前运行版本已从 Nuxt/Vue 迁移到 Next.js 16 App Router 与 React 19。系统提供公开文档站、单管理员后台、版本化 Markdown 内容、受控文件存储、备份恢复，以及可选的 Solana cNFT 项目访问凭证。

## 快速开始

### Docker Compose

仓库中的 Compose 配置会构建当前工作区，并启动 PostgreSQL 16 与 Next.js standalone 应用。

复制后编辑 `.env.docker`，至少替换 `DB_PASSWORD` 和 `ENCRYPTION_KEY`：

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
```

打开：

- 站点：`http://localhost:3000`
- 管理入口：`http://localhost:3000/admin`
- 首次使用：按页面引导创建管理员账号

默认持久化目录：

- PostgreSQL：`./docker-data/postgres`
- 上传文件：`./docker-data/uploads` → 容器 `/app/data/uploads`

`ENCRYPTION_KEY` 必须稳定保存。更换后，数据库中已有的 Solana Tree Authority 私钥将无法解密。

### 本地开发

要求：Node.js `>=22.12`、npm 11、PostgreSQL。

先创建 `.env`，因为 `npm ci` 的 `postinstall` 会生成 Prisma Client：

```env
DATABASE_URL="postgresql://user:password@127.0.0.1:5432/slothvault"
ENCRYPTION_KEY="replace-with-a-long-stable-random-secret"
UPLOAD_STORAGE_PATH="./data/uploads"
```

然后执行：

```bash
npm ci
npx prisma migrate deploy
npm run dev
```

生产构建：

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

## 功能

- 多项目文档：项目、版本、分类、笔记与多内容版本。
- Markdown：管理端编辑、3 秒自动保存、前台安全渲染与目录导航。
- 项目展示：首页 Markdown、两级项目菜单、版本切换和响应式阅读页面。
- 管理后台：项目、版本、分类、笔记、文件、首页、菜单与系统配置管理。
- 文件存储：文件位于非公开目录，通过受控 `/uploads/[...path]` 路由读取。
- 主题与语言：浅色/深色主题，中英文界面。
- 管理会话：HttpOnly Cookie、数据库会话、过期与撤销支持。
- 项目访问：短期 Ed25519 钱包签名证明，本地 cNFT 记录与可选 DAS 链上复核。
- Solana 管理：devnet/mainnet、Merkle Tree 估算/创建/验证、cNFT prepare/sign/submit。
- 备份恢复：数据库 JSON、上传 ZIP、严格导入校验、staging/rollback 与系统重置。

## 技术栈

| 层 | 实现 |
| --- | --- |
| Web | Next.js 16 App Router、React 19、TypeScript 5.9 |
| UI | Ant Design 6、Lucide React、CSS variables |
| 数据获取 | TanStack Query 5 |
| 客户端状态 | Zustand 5、next-themes |
| 国际化 | next-intl 4 |
| Markdown | `@uiw/react-md-editor`、react-markdown、remark/rehype |
| 数据库 | PostgreSQL、Prisma 7、`@prisma/adapter-pg` |
| 认证 | Argon2、数据库会话、Ed25519 钱包证明 |
| Solana | `@solana/web3.js` 1.98、SPL Account Compression 0.1.10、Wallet Adapter |
| 对象存储 | 本地受控上传目录；可选 Filebase S3/IPFS 元数据 |
| 部署 | Next standalone、Docker、Docker Compose |

## 架构

```mermaid
flowchart LR
    Browser["Browser / Wallet"] --> App["Next.js App Router"]
    App --> Pages["React pages and components"]
    App --> Routes["Route Handlers"]
    Routes --> Services["src/server services"]
    Services --> Prisma["Prisma adapter"]
    Prisma --> PostgreSQL[(PostgreSQL)]
    Services --> Uploads[(data/uploads)]
    Services --> Solana["Solana RPC / DAS"]
    Services --> Filebase["Filebase S3 / IPFS"]
    Browser -->|"wallet signatures"| Routes
```

数据库使用四个 schema：

- `auth`：管理员与会话
- `collections`：项目、版本、分类、菜单与项目首页
- `docs`：笔记及内容版本
- `public`：文件记录、系统配置、系统首页、Merkle Tree 与 cNFT

## 配置

系统设置页中的 RPC/Filebase 配置优先于同名环境变量；环境变量作为未配置时的 fallback。

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串；Docker entrypoint 也可由 `DB_*` 组合生成 |
| `ENCRYPTION_KEY` | 是 | Tree Authority 私钥与 Solana prepare 令牌的稳定根密钥 |
| `UPLOAD_STORAGE_PATH` | 否 | 上传根目录；默认 `<cwd>/data/uploads` |
| `SOLANA_RPC_URL` | 否 | 主网 RPC fallback |
| `SOLANA_DEVNET_RPC_URL` | 否 | devnet RPC fallback |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | 否 | 浏览器 Wallet Adapter endpoint；未设置时使用公共 devnet |
| `FILEBASE_ACCESS_KEY` | 否 | Filebase S3 Access Key fallback |
| `FILEBASE_SECRET_KEY` | 否 | Filebase S3 Secret Key fallback |
| `FILEBASE_BUCKET` | 否 | Filebase bucket fallback |
| `FILEBASE_ENDPOINT` | 否 | 默认 `https://s3.filebase.com` |

Docker 还支持：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DB_HOST` | `postgres` | 未提供 `DATABASE_URL` 时使用 |
| `DB_PORT` | `5432` | PostgreSQL 端口 |
| `DB_NAME` | `slothvault` | 数据库名 |
| `DB_USER` | `slothvault` | 数据库用户 |
| `DB_PASSWORD` | 无 | 必填密码 |
| `DB_WAIT_TIMEOUT` | `60` | entrypoint 等待数据库的秒数 |
| `POSTGRES_DATA_DIR` | `./docker-data/postgres` | Compose 主机数据目录 |
| `UPLOADS_DIR` | `./docker-data/uploads` | Compose 主机上传目录 |

## 上传与备份

上传文件不再放在 `public/uploads`。数据库仍保存 `/uploads/...` URL，但文件由 Next Route Handler 在 `UPLOAD_STORAGE_PATH` 下读取，并执行路径 containment、隐藏路径拒绝、MIME 与下载头控制。

数据库备份包括系统配置和加密后的 Tree Authority，因此仍应视为敏感文件。恢复流程具有以下限制：

- 数据库 JSON 最大请求体 50 MiB、最多 100,000 条业务记录。
- 上传 ZIP 最大 250 MiB、最多 10,000 个条目。
- 拒绝 ZIP Slip、符号链接、特殊文件、加密 ZIP、ZIP64 与校验失败条目。
- 数据库导出在 `REPEATABLE READ` 快照中生成关系闭包，避免有效子记录引用未导出的软删除父记录。
- overwrite 在 staging 完整校验后提交；失败时尝试恢复旧目录。
- 单个 Next.js 进程内，读请求可并行，写请求串行；文件导出会持有共享锁直到 ZIP 流关闭，避免与覆盖恢复或上传交错。
- 系统重置保留 `auth` schema 中的管理员与会话数据。

## Solana 安全流程

管理员发起 Tree/cNFT 操作时：

1. 服务端构建交易并用服务端拥有的 Tree/Authority Keypair 部分签名。
2. 服务端返回交易和 5 分钟加密 HMAC prepare 令牌；令牌不包含明文私钥。
3. 浏览器钱包补充 fee payer 签名。
4. submit 校验 prepare 消息哈希、fee payer、程序 ID、树/owner、全部 signer 与密码学签名。
5. submit 在广播前持久化确定性的 payer 交易签名、令牌到期时间和 `lastValidBlockHeight`，断线后仍可对账。
6. prepare 只在 PostgreSQL 行锁事务中预留容量；最终 `leafIndex` 与 asset PDA 仅从 confirmed 交易的 SPL Account Compression change-log 事件取得。
7. 待确认 attempt 会在列表刷新或下次 prepare 时按签名继续对账；只有明确失败/过期的 attempt 可删除，失败不会占用真实 asset ID。

链上创建和 mint 会产生真实 SOL 费用。请先在 devnet 验证 RPC、钱包、Tree 参数和 DAS 服务，再切换 mainnet。
升级既有数据库时必须先执行 `npx prisma migrate deploy`，以增加 cNFT attempt 对账字段和交易签名唯一索引。

## API 与迁移状态

完整页面/API 对应关系、59 个 API URL、83 个 HTTP 方法及安全修正见：

- [Nuxt → Next.js 迁移矩阵](docs/NUXT_TO_NEXT_MIGRATION.md)

旧实现目前保存在 `legacy-nuxt/` 与根目录旧 `server/` 中，仅用于迁移核对，不参与 Next 构建。外部链上写入和真实 Filebase 验收完成且获得明确清理授权前，不应删除这些参考文件。

## 目录结构

```text
src/
├── app/                    # Next pages、layouts、Route Handlers
├── components/             # React UI 与业务组件
├── i18n/                   # next-intl 请求配置
├── lib/                    # API client、钱包消息等共享逻辑
├── server/                 # 认证、HTTP 边界、Prisma 与业务服务
└── types/                  # 客户端/服务端共享类型

messages/                   # Next 中英文消息
prisma/                     # schema 与迁移
generated/prisma/           # Prisma 生成客户端
data/uploads/               # 当前运行上传目录（被 git 忽略）
data/uploads-legacy-nuxt/   # 迁移前上传备份（被 git 忽略）
legacy-nuxt/                # 保留的 Nuxt 页面与组件
server/                     # 保留的 Nuxt API 与旧服务
```

## 开发检查

```bash
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm run test       # Vitest 迁移契约与纯本地服务测试
npm run build      # Prisma generate + Next production build
```

需要额外验证 S3 协议或 Solana devnet 只读链路时，可显式启用 opt-in 测试：

```bash
RUN_FILEBASE_S3_SMOKE=1 npx vitest run src/server/services/filebase.test.ts
RUN_SOLANA_DEVNET_SMOKE=1 npx vitest run src/server/services/solana-devnet.integration.test.ts
```

默认 `npm test` 会跳过这两组测试，以免普通开发环境依赖本地 socket 或外部 RPC。当前迁移已在隔离 PostgreSQL/Docker 环境验证迁移、Session、CRUD、上传/ZIP、overwrite/reset/恢复、双实例并发、行锁和上传挂载跨容器持久化；真实 Filebase 凭据与 Solana devnet 写交易/DAS 仍需在对应环境验收。

## 许可证

当前仓库未包含 `LICENSE` 文件。若计划公开分发，请在发布前明确许可证。
