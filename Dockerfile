# syntax=docker/dockerfile:1

# @file Dockerfile
# @project SlothVault
# @module Production container image
# @description Builds a compact database-independent Next.js standalone image containing all supported Prisma providers and installer migrations without diagnostic source maps or foreign libc binaries.
# @logic Cache dependency/build stages, sanitize the traced standalone runtime and Prisma CLI closure for the target Alpine platform, then prepare persistent application directories.
# @dependencies Node.js 24.18.1 LTS Alpine, Next.js standalone, Prisma 7
# @index_tags docker, standalone, prisma, sqlite, mysql, postgresql
# @author holic512

FROM node:24.18.1-alpine AS base

WORKDIR /app

# Native Prisma adapters, argon2 and Sharp may load native binaries at runtime.
RUN apk add --no-cache libc6-compat libstdc++

FROM base AS deps
RUN apk add --no-cache g++ make python3
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY scripts/generate-prisma.mjs ./scripts/generate-prisma.mjs
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

FROM base AS runner

# The standalone output already contains the traced application dependencies
# and the exact Prisma CLI dependency closure added by the postbuild sanitizer.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /app/data/config /app/data/database /app/data/uploads \
    && chmod 700 /app/data /app/data/config /app/data/database /app/data/uploads

EXPOSE 3000

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    APP_DATA_PATH=/app/data \
    UPLOAD_STORAGE_PATH=/app/data/uploads

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
