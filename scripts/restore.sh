#!/usr/bin/env bash
# RavenCore Panel — full backup restore script
# Usage: cd /opt/raven && bash scripts/restore.sh /path/to/raven-backup-<timestamp>.tar.gz
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }

ARCHIVE="${1:-}"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_PROJECT=$(basename "$INSTALL_DIR")

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  err "Usage: bash scripts/restore.sh /path/to/raven-backup-<timestamp>.tar.gz"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root."
  exit 1
fi

cd "$INSTALL_DIR"

info "Stopping RavenCore containers…"
docker compose down || true

WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

info "Extracting backup archive…"
tar -xzf "$ARCHIVE" -C "$WORK_DIR"

# Load DB password from the backup's .env
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$WORK_DIR/.env" | cut -d= -f2 | tr -d '\"\' || true)
if [[ -z "$DB_PASSWORD" ]]; then
  err "Could not read DB_PASSWORD from backup .env"
  exit 1
fi

info "Restoring configuration files…"
for f in .env config.yml Caddyfile docker-compose.yml; do
  if [[ -f "$WORK_DIR/$f" ]]; then
    cp "$WORK_DIR/$f" "$INSTALL_DIR/$f"
    ok "Restored $f"
  fi
done

info "Starting database containers…"
docker compose up -d postgres mariadb

info "Waiting for databases to be ready…"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U raven >/dev/null 2>&1 && \
     docker compose exec -T mariadb mariadb -u raven -p"$DB_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

info "Restoring Postgres database…"
docker compose exec -T postgres psql -U raven -d raven -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null 2>&1 || true
docker compose exec -T postgres psql -U raven -d raven < "$WORK_DIR/postgres.sql"
ok "Postgres restored"

info "Restoring MariaDB database…"
docker compose exec -T mariadb mariadb -u raven -p"$DB_PASSWORD" -e "DROP DATABASE IF EXISTS raven; CREATE DATABASE raven;" || true
docker compose exec -T mariadb mariadb -u raven -p"$DB_PASSWORD" raven < "$WORK_DIR/mariadb.sql"
ok "MariaDB restored"

info "Restoring server container data…"
if [[ -f "$WORK_DIR/bots.tar.gz" ]]; then
  mkdir -p /var/lib/raven/bots
  tar -xzf "$WORK_DIR/bots.tar.gz" -C /var/lib/raven
  ok "Bot data restored"
else
  warn "No bots.tar.gz found in backup"
fi

info "Starting remaining services…"
docker compose up -d

ok "Restore complete. Update your domain DNS to point to $(curl -fsSL -4 https://ifconfig.me 2>/dev/null || echo 'this server') and wait for services to come online."
