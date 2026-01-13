# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SlothVault 是一个基于 Nuxt 4 的个人文档管理系统，集成 Solana 区块链的 cNFT 版权/阅读权限功能。系统面向单一管理员用户，提供前台文档展示和后台管理两套界面。

## Tech Stack

- **Framework**: Nuxt 4 (SSR + API routes)
- **Frontend**: Vue 3 Composition API, Element Plus, Pinia
- **Database**: PostgreSQL with Prisma ORM (multi-schema: auth, collections, docs, public)
- **Blockchain**: Solana (web3.js, SPL Account Compression for cNFT)
- **Storage**: Filebase (S3-compatible IPFS pinning)
- **i18n**: @nuxtjs/i18n (en/zh)

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm preview      # Preview production build

# Database
npx prisma migrate dev    # Run migrations
npx prisma generate       # Generate Prisma client (outputs to generated/prisma)
```

## Project Structure

```
app/                    # Nuxt source directory (configured via srcDir)
  pages/
    admin/mm/           # Admin management pages (SSR disabled)
    project/[id]/       # Public project pages
  components/
    admin/mm/           # Admin components
    mdEditor/           # Markdown editor components
  stores/               # Pinia stores
  layouts/              # admin-mm.vue, project.vue
server/
  api/
    admin/              # Admin APIs (auth, mm/*, solana/*)
    project/            # Public project APIs
    solana/             # Public Solana APIs
  utils/                # Server utilities (prisma, response, solana, etc.)
prisma/
  schema.prisma         # Multi-schema: auth, collections, docs, public
i18n/locales/           # en.json, zh.json
```

## Key Patterns

### API Response Format
All API responses use `server/utils/response.ts`:
```typescript
ok(data)              // { code: 0, message: 'ok', data }
fail(message, code)   // { code, message, data: null }
```

### Database Access
Prisma client is singleton in `server/utils/prisma.ts`. Generated client is at `generated/prisma`.

### Admin Routes
All `/admin/**` routes have SSR disabled (client-side only) via `nuxt.config.ts` routeRules.

### Solana Integration
- Tree/cNFT management in `server/api/admin/solana/`
- Bubblegum protocol utilities in `server/utils/bubblegum.ts`
- Private keys are AES-256-GCM encrypted before storage

### Buffer Polyfill
Browser Buffer polyfill configured in `nuxt.config.ts` and `app/plugins/buffer.client.ts` for Solana SDK compatibility.

## Database Schemas

- **auth**: User, Session
- **collections**: Project, ProjectVersion, Category, ProjectMenu, ProjectHome
- **docs**: NoteInfo, NoteContent
- **public**: FileManagement, SystemConfig, MerkleTree, CompressedNft
