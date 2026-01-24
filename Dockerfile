# Multi-stage build for SlothVault with embedded PostgreSQL
FROM node:20-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./

# Install dependencies stage
FROM base AS deps
RUN pnpm install --frozen-lockfile

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN pnpm build

# Production stage with PostgreSQL
FROM node:20-alpine AS runner

# Install PostgreSQL and required tools
RUN apk add --no-cache postgresql postgresql-contrib openssl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy production dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile

# Copy built application
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create directories for PostgreSQL and app data
RUN mkdir -p /var/lib/postgresql/data /app/data && \
    chown -R postgres:postgres /var/lib/postgresql

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PGDATA=/var/lib/postgresql/data

# Use entrypoint script
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
