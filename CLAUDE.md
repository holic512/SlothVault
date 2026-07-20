# CLAUDE.md

## Project Overview

SlothVault now runs on Next.js 16 App Router and React 19. It provides public Markdown publications, conventional user accounts and profiles, an administrator-only publishing console, points and gift cards, controlled local file storage, and optional Solana cNFT article copyright certificates.

## Current Stack

- Next.js 16, React 19, TypeScript
- Ant Design 6, TanStack Query, Zustand
- next-intl and next-themes
- SQLite, MySQL, or PostgreSQL through provider-specific Prisma 7 clients
- Redis 7 / node-redis for short-lived wallet-login challenges and rate limits
- Solana web3.js, SPL Account Compression, React Wallet Adapter
- `@uiw/react-md-editor` and react-markdown
- Next standalone Docker runtime

## Active Source Boundaries

- Pages/layouts: `src/app/**`
- React components: `src/components/**`
- APIs: `src/app/api/**/route.ts`
- Server boundaries and services: `src/server/**`
- Prisma schema/migrations: `prisma/**`
- Prisma generated client: `generated/prisma/**`
- Translations: `messages/**`

`legacy-nuxt/**` and the root legacy `server/**` tree are migration references only. Do not import them into current code or delete them before the corresponding Next flows have passed real environment verification.

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
- Never expose `MerkleTree.encryptedKey` or stored secret configuration values.

## Security Invariants

- Runtime uploads live under `UPLOAD_STORAGE_PATH` (default `data/uploads`), never `public/uploads`.
- Enforce path containment, regular-file checks, request limits, and image decoding on file operations.
- Treat database backups as sensitive because they include configuration and encrypted authority keys.
- Keep every published article publicly readable; wallet/cNFT ownership must never gate reading.
- Bind Solana submit transactions to their prepare token, fee payer, programs, tree/owner, complete cryptographic signatures, article ID, and copyright owner record.
- Allocate cNFT leaves under a PostgreSQL row lock and do not decrement potentially exposed indexes.
- Preserve compatibility with existing `ENCRYPTION_KEY` ciphertexts.

## Validation

```bash
npm run typecheck
npm run lint
npm run build
```

Database restore/reset, filesystem overwrite, Docker volume persistence, Solana, DAS, and Filebase require isolated real-service tests before claiming end-to-end completion.
