# Multi-stage Next.js standalone image for SlothVault.
FROM node:22-alpine AS base

WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/slothvault"
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/slothvault"
RUN npm run build

FROM node:22-alpine AS runner

# pg_isready is used by the entrypoint to wait for an external PostgreSQL.
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Keep the Prisma CLI available for migrate deploy, then overlay the traced
# standalone runtime and its exact server dependencies.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated

# Copy Prisma config, schema and migrations (required for prisma migrate deploy in Prisma 7)
COPY prisma.config.ts ./
COPY prisma ./prisma

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Runtime uploads live outside public/ and are served only by the guarded
# /uploads/[...path] route.
RUN mkdir -p /app/data/uploads

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    UPLOAD_STORAGE_PATH=/app/data/uploads

# Use entrypoint script
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
