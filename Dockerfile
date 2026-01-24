# Multi-stage build for SlothVault with embedded PostgreSQL
FROM node:20-alpine AS base

WORKDIR /app
COPY package.json package-lock.json ./

# Install dependencies stage
FROM base AS deps
RUN npm ci

# Build stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Set a dummy DATABASE_URL for prisma generate (not used, just required)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npx prisma generate
RUN npm run build

# Production stage with PostgreSQL
FROM node:20-alpine AS runner

# Install PostgreSQL and required tools
RUN apk add --no-cache postgresql postgresql-contrib openssl su-exec

WORKDIR /app

# Copy production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
