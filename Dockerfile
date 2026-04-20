# Multi-stage build for SlothVault Next.js app with embedded PostgreSQL
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies stage
FROM base AS deps
# Copy only package files for better layer caching
COPY package.json package-lock.json ./
RUN npm install

# Build stage
FROM base AS builder
# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
# Copy source files
COPY . .
# Set a dummy DATABASE_URL for prisma generate (required by schema.prisma but not actually used during generation)
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/slothvault"
# Generate Prisma client and build app
RUN npx prisma generate && npm run build

# Production stage with PostgreSQL
FROM node:20-alpine AS runner

# Install PostgreSQL and required tools in one layer
RUN apk add --no-cache postgresql postgresql-contrib openssl su-exec

WORKDIR /app

# Copy production dependencies from deps stage (reuse existing node_modules)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Copy built Next.js standalone application
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/generated ./generated

# Copy Prisma config, schema and migrations (required for prisma migrate deploy in Prisma 7)
COPY prisma.config.ts ./
COPY prisma ./prisma

# Copy public directory for runtime file uploads
COPY public ./public

# Create uploads directory in public for runtime file storage
RUN mkdir -p /app/public/uploads

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create directories for PostgreSQL and app data
RUN mkdir -p /var/lib/postgresql/data /app/data /run/postgresql && \
    chown -R postgres:postgres /var/lib/postgresql /run/postgresql

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PGDATA=/var/lib/postgresql/data

# Use entrypoint script
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
