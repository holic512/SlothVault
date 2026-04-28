#!/bin/sh
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo "${GREEN}[SlothVault]${NC} $1"
}

log_warn() {
    echo "${YELLOW}[SlothVault]${NC} $1"
}

log_error() {
    echo "${RED}[SlothVault]${NC} $1"
}

# Ensure /run/postgresql exists with correct ownership
log_info "Setting up PostgreSQL runtime directory..."
mkdir -p /run/postgresql
chown -R postgres:postgres /run/postgresql

# Generate random encryption key if not provided
if [ -z "$ENCRYPTION_KEY" ]; then
    log_info "Generating random encryption key..."
    export ENCRYPTION_KEY=$(openssl rand -hex 32)
    log_info "Generated ENCRYPTION_KEY: $ENCRYPTION_KEY"
    log_warn "IMPORTANT: Save this key if you need to persist data across container restarts!"
fi

# Set default database password if not provided
if [ -z "$DB_PASSWORD" ]; then
    export DB_PASSWORD=$(openssl rand -base64 16)
    log_info "Generated database password"
fi

# Database configuration - export for child processes
export DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost:5432/slothvault"

# Initialize PostgreSQL if not already initialized
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    log_info "Initializing PostgreSQL database..."

    # Initialize database as postgres user
    su-exec postgres initdb -D "$PGDATA" --encoding=UTF8 --locale=en_US.UTF-8

    # Configure PostgreSQL
    echo "host all all 127.0.0.1/32 trust" >> "$PGDATA/pg_hba.conf"
    echo "local all all trust" >> "$PGDATA/pg_hba.conf"

    # Start PostgreSQL temporarily to create database and schemas
    su-exec postgres pg_ctl -D "$PGDATA" -w start

    # Wait for PostgreSQL to be ready
    sleep 2

    # Create database and schemas
    log_info "Creating database and schemas..."
    su-exec postgres psql -v ON_ERROR_STOP=1 <<-EOSQL
        CREATE DATABASE slothvault;
        \c slothvault
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE SCHEMA IF NOT EXISTS collections;
        CREATE SCHEMA IF NOT EXISTS docs;
        CREATE SCHEMA IF NOT EXISTS public;
        ALTER USER postgres WITH PASSWORD '${DB_PASSWORD}';
EOSQL

    # Stop PostgreSQL
    su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop

    log_info "Database initialized successfully"
else
    log_info "Using existing PostgreSQL database"
fi

# Start PostgreSQL in background
log_info "Starting PostgreSQL..."
su-exec postgres pg_ctl -D "$PGDATA" -w start

# Wait for PostgreSQL to be ready
log_info "Waiting for PostgreSQL to be ready..."
until su-exec postgres pg_isready -q; do
    sleep 1
done
log_info "PostgreSQL is ready"

# Run Prisma migrations
log_info "Running database migrations..."
cd /app
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations)" ]; then
    log_info "Found migrations directory, applying migrations..."
    DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost:5432/slothvault" npx prisma migrate deploy
    if [ $? -eq 0 ]; then
        log_info "Migrations applied successfully"
    else
        log_error "Migration failed!"
        exit 1
    fi
else
    log_warn "No migrations found in prisma/migrations directory"
    log_warn "Tables will not be created. Please ensure migrations are included in the Docker image."
fi

# Start the application with environment variables
log_info "Starting SlothVault application on port ${PORT}..."
log_info "=========================================="
log_info "SlothVault is ready!"
log_info "Access at: http://localhost:${PORT}"
log_info "Admin panel: http://localhost:${PORT}/admin"
log_info "=========================================="

exec env DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost:5432/slothvault" ENCRYPTION_KEY="$ENCRYPTION_KEY" node .output/server/index.mjs
