#!/bin/sh
set -eu

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

require_env() {
    var_name="$1"
    eval "value=\${$var_name:-}"
    if [ -z "$value" ]; then
        log_error "$var_name is required"
        exit 1
    fi
}

if [ "${1:-start}" != "start" ]; then
    exec "$@"
fi

require_env ENCRYPTION_KEY

if [ -n "${DATABASE_URL:-}" ]; then
    log_info "Using DATABASE_URL for PostgreSQL connection"
else
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-slothvault}"
    DB_USER="${DB_USER:-slothvault}"

    require_env DB_HOST
    require_env DB_PASSWORD

    export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    log_info "Using DB_HOST/DB_PORT/DB_NAME/DB_USER for PostgreSQL connection"
fi

UPLOAD_STORAGE_PATH="${UPLOAD_STORAGE_PATH:-/app/data/uploads}"
export UPLOAD_STORAGE_PATH
mkdir -p "$UPLOAD_STORAGE_PATH"

DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"
elapsed=0
log_info "Waiting for PostgreSQL to be ready..."
until pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; do
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$DB_WAIT_TIMEOUT" ]; then
        log_error "PostgreSQL did not become ready within ${DB_WAIT_TIMEOUT}s"
        exit 1
    fi
    sleep 1
done
log_info "PostgreSQL is ready"

# Run Prisma migrations
log_info "Running database migrations..."
cd /app
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations)" ]; then
    log_info "Found migrations directory, applying migrations..."
    if ./node_modules/.bin/prisma migrate deploy; then
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

exec node server.js
