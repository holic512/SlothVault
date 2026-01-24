# Multi-stage build for SlothVault with embedded PostgreSQL
FROM node:24-alpine AS base

WORKDIR /app

# Install dependencies stage
FROM base AS deps
# Copy only package files for better layer caching
COPY package.json package-lock.json ./
# Use npm install for better compatibility
RUN npm install

# Build stage
FROM base AS builder
# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
# Copy source files
COPY . .
# Set a dummy DATABASE_URL for prisma generate (not used, just required)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
# Generate Prisma client and build app
RUN npx prisma generate && npm run build

# Production stage with PostgreSQL
FROM node:24-alpine AS runner

# Install PostgreSQL and required tools in one layer
RUN apk add --no-cache postgresql postgresql-contrib openssl su-exec

WORKDIR /app

# Copy production dependencies from deps stage (reuse existing node_modules)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

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
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PGDATA=/var/lib/postgresql/data

# Use entrypoint script
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
