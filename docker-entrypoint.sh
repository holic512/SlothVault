#!/bin/sh
# @file docker-entrypoint.sh
# @project SlothVault
# @module Container bootstrap
# @description Prepares persistent application directories and starts the installable standalone server without requiring a database.
# @logic Enforce application-managed database configuration, prepare private data mounts, then exec the Next.js standalone runtime.
# @dependencies Next.js standalone server, APP_DATA_PATH
# @index_tags docker, bootstrap, installer, persistence
# @author holic512

set -eu

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo "${GREEN}[SlothVault]${NC} $1"
}

log_warn() {
    echo "${YELLOW}[SlothVault]${NC} $1"
}

if [ "${1:-start}" != "start" ]; then
    exec "$@"
fi

if [ -n "${DATABASE_URL:-}${DB_HOST:-}${DB_NAME:-}${DB_USER:-}${DB_PASSWORD:-}" ]; then
    log_warn "DATABASE_URL and DB_* are ignored; configure the database in /install"
fi
unset DATABASE_URL DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD DB_WAIT_TIMEOUT

APP_DATA_PATH="${APP_DATA_PATH:-/app/data}"
UPLOAD_STORAGE_PATH="${UPLOAD_STORAGE_PATH:-${APP_DATA_PATH}/uploads}"
export APP_DATA_PATH UPLOAD_STORAGE_PATH

mkdir -p \
    "${APP_DATA_PATH}/config" \
    "${APP_DATA_PATH}/database" \
    "$UPLOAD_STORAGE_PATH"
chmod 700 \
    "$APP_DATA_PATH" \
    "${APP_DATA_PATH}/config" \
    "${APP_DATA_PATH}/database" \
    "$UPLOAD_STORAGE_PATH"

log_info "Starting SlothVault on port ${PORT:-3000}"
log_info "Open /install to configure SQLite, MySQL, or PostgreSQL"

cd /app
exec node server.js
