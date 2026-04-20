# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## Project Overview

SlothVault 是一个基于 Next.js App Router 的个人文档管理系统，集成 Solana 区块链的 cNFT 版权/阅读权限功能。系统面向单一管理员用户，提供前台文档展示和后台管理两套界面。

当前项目已经从 Nuxt 全量迁移到 Next.js。旧 Nuxt 前端已删除，不应再按 Vue/Nuxt 方式实现新功能。

## Tech Stack

- **Framework**: Next.js 15 (App Router + Route Handlers)
- **Frontend**: React 19, TypeScript, Ant Design, Zustand, TanStack Query
- **Markdown**: `md-editor-rt`, `react-markdown`, `remark-gfm`, `rehype-highlight`
- **Database**: PostgreSQL with Prisma ORM (multi-schema: `auth`, `collections`, `docs`, `public`)
- **Blockchain**: Solana (`web3.js`, SPL Account Compression for cNFT)
- **Storage**: Filebase (S3-compatible IPFS pinning)
- **i18n**: `next-intl` (`en` / `zh`)

## Important Structure

- `src/app`: Next.js pages, layouts, and route handlers
- `src/components`: React UI components for public site and admin
- `src/store`: Zustand stores
- `src/lib`: shared frontend helpers
- `src/server`: Next runtime compatibility and shared server-side logic
- `server/api`: legacy business handlers retained and wrapped by Next route handlers
- `server/routes`: legacy non-API route handlers retained and wrapped by Next
- `server/utils`: Prisma, session, upload, Solana, auth, and other server utilities
- `src/styles/legacy`: CSS migrated from the old frontend and still used by the current app

## Runtime Notes

- Public and admin APIs must preserve the existing `/api/**` contract and `ApiResponse<T>` shape: `{ code, message, data }`.
- Session auth still uses the `sv_session` cookie and database-backed sessions. Do not introduce NextAuth unless explicitly requested.
- Solana server logic depends on `server/utils/solana.cjs`; keep the static CJS loading approach intact.
- Uploads are served from `public/uploads` and still exposed through `/uploads/**`.
- The Next route handlers under `src/app/api/**` are thin wrappers around the existing `server/api/**` and `server/routes/**` logic. Prefer reusing that server logic instead of rewriting behavior ad hoc.

## Common Commands

- Dev: `npm run dev`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Regenerate Prisma client: `npm run postinstall` or `npx prisma generate`
- Regenerate Next route wrappers from legacy handlers: `npm run generate:routes`

## API Import References

For existing server handlers, keep using:

```ts
import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
```

For Next route handlers, prefer wrapping existing handlers through:

```ts
import { handleLegacyApiRequest } from '@/server/compat/adapter'
```

## Implementation Guidance

- Default to implementing new UI in React under `src/app` and `src/components`.
- Do not reintroduce Nuxt, Vue, Pinia, or Element Plus code.
- If touching API behavior, preserve route paths, request methods, response shape, and current auth semantics unless the user explicitly asks to break compatibility.
- If editing Solana-related server code, validate both build-time and runtime loading behavior.
