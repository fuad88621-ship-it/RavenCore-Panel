#!/usr/bin/env bash
# RavenCore Panel — one-command installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
set -euo pipefail

REPO="https://github.com/fuad88621-ship-it/RavenCore-Panel.git"
INSTALL_DIR="/opt/raven"

# ─── Colors ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Helpers ────────────────────────────────────────────────────────
info() { echo -e "${BLUE}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "This installer must be run as root. Try: sudo bash install.sh"
    exit 1
  fi
}

install_system_deps() {
  info "Installing system dependencies…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates openssl git jq >/dev/null
  ok "System dependencies installed"
}

install_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    info "Installing Docker…"
    curl -fsSL https://get.docker.com | sh
  else
    ok "Docker already installed"
  fi

  if ! docker compose version >/dev/null 2>&1; then
    info "Installing Docker Compose plugin…"
    apt-get install -y -qq docker-compose-plugin >/dev/null
  else
    ok "Docker Compose already installed"
  fi
}

download_panel() {
  if [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    warn "$INSTALL_DIR already contains RavenCore files."
    read -rp "Update from git? [y/N]: " update
    if [[ "$update" =~ ^[Yy]$ ]]; then
      cd "$INSTALL_DIR"
      git pull
    fi
  else
    info "Downloading RavenCore Panel from GitHub…"
    mkdir -p "$INSTALL_DIR"
    git clone "$REPO" "$INSTALL_DIR"
    ok "Downloaded to $INSTALL_DIR"
  fi
}

generate_secrets() {
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    ok ".env already exists — keeping existing secrets"
    return
  fi

  info "Generating secure secrets…"
  cd "$INSTALL_DIR"
  cp .env.example .env

  DB_PASSWORD=$(openssl rand -hex 32)
  SESSION_SECRET=$(openssl rand -hex 32)
  AGENT_TOKEN=$(openssl rand -hex 32)
  CONSOLE_SECRET=$(openssl rand -hex 32)

  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$DB_PASSWORD|" .env
  sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$SESSION_SECRET|" .env
  sed -i "s|^AGENT_TOKEN=.*|AGENT_TOKEN=$AGENT_TOKEN|" .env
  sed -i "s|^CONSOLE_SECRET=.*|CONSOLE_SECRET=$CONSOLE_SECRET|" .env

  chmod 600 .env
  ok "Secrets generated in $INSTALL_DIR/.env"
}

build_and_start() {
  local services="$1"
  info "Building and starting services: $services"
  cd "$INSTALL_DIR"

  if [[ "$services" == "panel" ]]; then
    docker compose up -d --build postgres redis mariadb panel caddy
  elif [[ "$services" == "agent" ]]; then
    docker compose up -d --build agent
  else
    docker compose up -d --build
  fi

  ok "Services started"
}

print_summary() {
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  RavenCore Panel installed successfully!${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  Installation directory: $INSTALL_DIR"
  echo "  Config file:            $INSTALL_DIR/config.yml"
  echo "  Secrets:                $INSTALL_DIR/.env"
  echo ""
  echo "  Next steps:"
  echo "    1. Update config.yml with your domain names."
  echo "    2. Point your domains to this server's IP."
  echo "    3. Run: cd $INSTALL_DIR && docker compose up -d --build"
  echo "    4. Open the Panel URL and register your first account."
  echo "    5. Promote that account to admin (see README)."
  echo ""
}

show_menu() {
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  RavenCore Panel Installer${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo "  [1] Install Panel"
  echo "  [2] Install Agent (Wings)"
  echo "  [3] Install Panel + Agent"
  echo "  [4] Exit"
  echo ""
}

install_panel() {
  install_system_deps
  install_docker
  download_panel
  generate_secrets
  build_and_start "panel"
  print_summary
}

install_agent() {
  install_system_deps
  install_docker
  download_panel
  generate_secrets
  build_and_start "agent"
  ok "Agent installed. Add this machine as a node in the Panel."
}

install_both() {
  install_system_deps
  install_docker
  download_panel
  generate_secrets
  build_and_start "both"
  print_summary
}

# ─── Main ───────────────────────────────────────────────────────────
main() {
  require_root

  while true; do
    show_menu
    read -rp "Select an option [1-4]: " choice
    case "$choice" in
      1)
        install_panel
        exit 0
        ;;
      2)
        install_agent
        exit 0
        ;;
      3)
        install_both
        exit 0
        ;;
      4)
        echo "Exiting."
        exit 0
        ;;
      *)
        err "Invalid option. Please choose 1-4."
        sleep 1
        ;;
    esac
  done
}

main "$@"
