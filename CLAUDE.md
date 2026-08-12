# CLAUDE.md

## Project Overview

SlothVault runs on Next.js 16 App Router and React 19 with optional Solana Memo transaction evidence for immutable project releases.

## Current Stack

- Next.js 16, React 19, TypeScript
- Ant Design 6, TanStack Query, Zustand
- next-intl and next-themes
- SQLite, MySQL, or PostgreSQL through provider-specific Prisma 7 clients
- Process-local Node.js memory for short-lived wallet-login challenges and rate limits
- Solana web3.js, Memo Program, React Wallet Adapter
- `@uiw/react-md-editor` and react-markdown
- Next standalone Docker runtime

## Active Source Boundaries

- Pages/layouts: `src/app/**`
- React components: `src/components/**`
- APIs: `src/app/api/**/route.ts`
- Server boundaries and services: `src/server/**`
- Prisma schema/migrations: `prisma/**`
- Provider-specific generated clients: `generated/prisma-{postgresql,mysql,sqlite}/**`
- Translations: `messages/**`

## Route Handler Pattern

```ts
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'
```

- Authenticate every admin API with `requireAdminSession`; it must enforce the `ADMIN` role. Use `requireUserSession` for ordinary account APIs.
- Use `defineRoute`, `HttpError`, Zod, and the standard `{ code, message, data }` envelope.
- Keep database transactions, filesystem compensation, DTO mapping, and chain logic in `src/server/services`.
- Never expose stored secret configuration values or custom RPC URLs.

## Security Invariants

- Runtime uploads live under `UPLOAD_STORAGE_PATH` (default `data/uploads`), never `public/uploads`.
- Enforce path containment, regular-file checks, request limits, and image decoding on file operations.
- Treat database backups as sensitive because they include accounts, configuration, and evidence indexes.
- Keep every published article publicly readable; wallet or evidence state must never gate reading.
- Bind Solana submission to the prepared message hash, Memo, program, network, blockhash, fee payer, signing wallet, and complete signature; persist the signature before broadcast.

## Validation

```bash
npm run typecheck
npm run lint
npm run build
```

Database restore/reset, filesystem overwrite, Docker volume persistence, and Solana require isolated real-service tests before claiming end-to-end completion.
