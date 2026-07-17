# CODEX.md

## 开发流程

实现功能前先确认业务目标、相关 Prisma 模型、现有服务边界和工作区差异；修改后执行与风险匹配的 typecheck、lint、build 或集成测试。不要覆盖来源不明的修改，也不要在未验证对应功能前删除 legacy 实现。

## 项目概览

SlothVault 当前运行栈是 Next.js 16 App Router + React 19。系统面向单一管理员，提供公开 Markdown 文档站、管理后台、本地受控文件存储，以及可选的 Solana cNFT 项目访问权限。

## 当前技术栈

- Framework: Next.js 16（App Router、Route Handlers、standalone）
- Frontend: React 19、Ant Design 6、TanStack Query、Zustand
- Theme/i18n: next-themes、next-intl
- Markdown: `@uiw/react-md-editor`、react-markdown、remark/rehype
- Database: PostgreSQL + Prisma 7（auth、collections、docs、public）
- Blockchain: `@solana/web3.js`、SPL Account Compression、React Wallet Adapter
- Storage: `data/uploads` 受控路由；可选 Filebase S3/IPFS

## 当前代码边界

- 页面和布局：`src/app/**`
- React 组件：`src/components/**`
- API：`src/app/api/**/route.ts`
- 服务端认证/HTTP/业务：`src/server/**`
- Prisma Client：`generated/prisma/**`
- 文案：`messages/en.json`、`messages/zh.json`
- Nuxt 参考：`legacy-nuxt/**` 与根目录旧 `server/**`，不属于当前运行入口

## Route Handler 约定

```ts
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
```

- 管理 API 必须先调用 `requireAdminSession(request)`。
- 使用 `defineRoute` 统一映射 `HttpError`、Zod 和未知错误。
- 响应使用 `{ code, message, data }` envelope，并让 `apiOk` 处理 BigInt。
- 业务事务与 DTO 映射优先放在 `src/server/services`，Route Handler 保持薄层。

## 安全不变量

- 上传根由 `UPLOAD_STORAGE_PATH` 控制，默认 `data/uploads`；不要重新创建 `public/uploads`。
- 任何存储路径必须做 containment 与符号链接检查。
- 敏感配置不回显；数据库备份视为敏感数据。
- Solana submit 必须绑定 prepare 消息、fee payer、程序、树/owner 和完整签名。
- cNFT leaf 分配必须持有 `merkle_tree` 行锁；失败/删除不得回退可能已暴露的索引。
- `ENCRYPTION_KEY` 格式兼容现有 Tree Authority 密文，不得随意更换 KDF/旧密文格式。

## 常用验证

```bash
npm run typecheck
npm run lint
npm run build
```

数据库恢复、文件 overwrite/reset、Solana 与 Filebase 变更需要隔离的真实集成环境；不得把静态检查写成链上或数据库验证已完成。
