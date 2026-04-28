# Multi-stage build for SlothVault application image
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

# Production stage
FROM node:20-alpine AS runner

# pg_isready is used by the entrypoint to wait for an external PostgreSQL.
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy production dependencies from deps stage (reuse existing node_modules)
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Copy built application
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/generated ./generated

# Copy Prisma config, schema and migrations (required for prisma migrate deploy in Prisma 7)
COPY prisma.config.ts ./
COPY prisma ./prisma

# Copy public directory for runtime file uploads
COPY public ./public

# Copy startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create upload directory for runtime file storage
RUN mkdir -p /app/public/uploads

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Use entrypoint script
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["start"]
