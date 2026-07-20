# @file Dockerfile
# @project SlothVault
# @module Production container image
# @description Builds a database-independent Next.js standalone image containing all supported Prisma providers and installer migrations.
# @logic Generate all clients at build time, retain the Prisma CLI and native adapters, then prepare separate persistent runtime directories.
# @dependencies Node.js 22 Alpine, Next.js standalone, Prisma 7
# @index_tags docker, standalone, prisma, sqlite, mysql, postgresql
# @author holic512

FROM node:22-alpine AS base

WORKDIR /app

# Native Prisma adapters, argon2 and Sharp may load native binaries at runtime.
RUN apk add --no-cache libc6-compat libstdc++

FROM base AS deps
RUN apk add --no-cache g++ make python3
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/generate-prisma.mjs ./scripts/generate-prisma.mjs
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner

# Keep the Prisma CLI and native adapters available for installer-driven
# migrations, then overlay the traced standalone runtime.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated

# The installer selects one of these fixed schemas and committed migrations.
COPY prisma.config.ts ./
COPY --from=builder /app/prisma/providers/postgresql ./prisma/providers/postgresql
COPY --from=builder /app/prisma/providers/mysql ./prisma/providers/mysql
COPY --from=builder /app/prisma/providers/sqlite ./prisma/providers/sqlite

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data/config /app/data/database /app/data/uploads \
    && chmod 700 /app/data /app/data/config /app/data/database /app/data/uploads

EXPOSE 3000

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_DATA_PATH=/app/data \
    UPLOAD_STORAGE_PATH=/app/data/uploads

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
