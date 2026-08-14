#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  RavenCore Panel — Node Installer
#  Run this on a NEW VPS to connect it to your panel as a node.
#
#    bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
#
#  Commands:
#    (no args)  - install, or show menu if already installed
#    --update   - re-download + rebuild the agent (no questions)
#    --delete   - fully remove the agent (keeps other apps like Pterodactyl)
# ═══════════════════════════════════════════════════════════════════

set -e
set -o pipefail

# ── Self-materialize: if run via `bash <(curl ...)`, save to a real file and
# re-exec from it. Reading from the one-shot /dev/fd/<n> pipe can glitch (it
# can't be re-read), which caused 'command not found' errors for some users.
if [[ "$0" == /dev/fd/* ]] || [[ "$0" == /proc/self/fd/* ]]; then
  SELF_URL="https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh"
  TMP="$(mktemp /tmp/raven-install.XXXXXX.sh)"
  curl -fsSL "$SELF_URL" -o "$TMP" || { echo "Could not re-download installer"; exit 1; }
  exec bash "$TMP" "$@"
fi

# ── Colors + helpers (defined FIRST so every part of the script can use them) ──
C_RESET='\033[0m'; C_GREEN='\033[32m'; C_CYAN='\033[36m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_BOLD='\033[1m'

info()  { echo -e "${C_CYAN}[i]${C_RESET} $1"; }
ok()    { echo -e "${C_GREEN}[✓]${C_RESET} $1"; }
warn()  { echo -e "${C_YELLOW}[!]${C_RESET} $1"; }
fail()  { echo -e "${C_RED}[✗]${C_RESET} $1"; exit 1; }

REPO_TARBALL="https://github.com/fuad88621-ship-it/RavenCore-Panel/archive/refs/heads/main.tar.gz"

# ── Update: re-download + rebuild the agent ──────────────────────
update_agent() {
  AGENT_DIR="/opt/raven-agent"
  if [ ! -f "$AGENT_DIR/docker-compose.yml" ]; then
    fail "No existing agent found at ${AGENT_DIR}. Run the installer normally first."
  fi
  info "Updating the RavenCore agent…"
  TARBALL="$(mktemp)"
  curl -fsSL --max-time 120 -o "$TARBALL" "$REPO_TARBALL" \
    || fail "Could not download the agent source."
  # Extract ONLY the agent/ directory into a temp dir, then copy it over.
  # Never extract the whole repo — the repo root has the PANEL's
  # docker-compose.yml which would overwrite this node's agent compose.
  TMPDIR="$(mktemp -d)"
  tar -xzf "$TARBALL" -C "$TMPDIR" --strip-components=1 2>/dev/null \
    || fail "Could not extract the agent source."
  rm -f "$AGENT_DIR/agent/Dockerfile"
  rm -rf "$AGENT_DIR/agent/src"
  cp -r "$TMPDIR/agent/Dockerfile" "$TMPDIR/agent/package.json" "$TMPDIR/agent/package-lock.json" "$TMPDIR/agent/src" "$AGENT_DIR/agent/" 2>/dev/null \
    || cp -r "$TMPDIR/agent/." "$AGENT_DIR/agent/"
  rm -rf "$TMPDIR" "$TARBALL"
  COMPOSE="docker compose"
  docker compose version >/dev/null 2>&1 || COMPOSE="docker-compose"
  cd "$AGENT_DIR"
  info "Rebuilding the agent… (takes a few minutes)"
  if ! $COMPOSE up -d --build --remove-orphans 2>&1 | tee /tmp/raven-agent-update.log | tail -15; then
    fail "Agent update failed. See output above."
  fi
  sleep 4
  if ! $COMPOSE ps agent 2>/dev/null | grep -q 'Up'; then
    $COMPOSE logs --tail 20 agent 2>&1 || true
    fail "Agent is not running after update."
  fi
  ok "Agent updated and running!"
}

# ── Delete: fully remove the RavenCore agent from this VPS ───────
# SAFETY: only removes RavenCore's own containers (labeled raven.uuid),
# networks (raven-*), the agent data dir and the agent source. Pterodactyl's
# wings containers/networks are never touched.
delete_agent() {
  echo ""
  echo -e "${C_RED}${C_BOLD}  ╔══════════════════════════════════════════════════════╗"
  echo -e "  ║  WARNING: this removes the RavenCore agent + ALL its servers  ║"
  echo -e "  ║  from this VPS. Pterodactyl and other containers are SAFE.   ║"
  echo -e "  ╚══════════════════════════════════════════════════════╝${C_RESET}"
  echo ""
  read -rp "  Type DELETE to confirm: " CONFIRM
  [ "$CONFIRM" = "DELETE" ] || fail "Aborted."

  AGENT_DIR="/opt/raven-agent"

  # 1. Stop + remove the agent container itself
  if [ -f "$AGENT_DIR/docker-compose.yml" ]; then
    info "Stopping the agent container…"
    (cd "$AGENT_DIR" && docker compose down 2>/dev/null || true)
  fi

  # 2. Remove ONLY RavenCore server containers (labeled raven.uuid)
  info "Removing RavenCore server containers…"
  RAVEN_CONTAINERS="$(docker ps -aq --filter 'label=raven.uuid' 2>/dev/null || true)"
  if [ -n "$RAVEN_CONTAINERS" ]; then
    echo "$RAVEN_CONTAINERS" | xargs -r docker rm -f >/dev/null 2>&1 || true
    ok "Removed $(echo "$RAVEN_CONTAINERS" | wc -l) RavenCore container(s)"
  else
    ok "No RavenCore containers found"
  fi

  # 3. Remove RavenCore networks (raven-*)
  info "Removing RavenCore networks…"
  RAVEN_NETS="$(docker network ls -q --filter 'name=raven-' 2>/dev/null || true)"
  if [ -n "$RAVEN_NETS" ]; then
    echo "$RAVEN_NETS" | xargs -r docker network rm >/dev/null 2>&1 || true
    ok "Removed RavenCore network(s)"
  else
    ok "No RavenCore networks found"
  fi

  # 4. Remove the agent data dir (server files) + agent source
  DATA_DIR="$(grep -oP 'BOT_DATA_DIR: \K[^ ]+' "$AGENT_DIR/docker-compose.yml" 2>/dev/null || echo '/var/lib/raven/bots')"
  info "Removing server data at ${DATA_DIR}…"
  rm -rf "$DATA_DIR" 2>/dev/null || true
  info "Removing agent source at ${AGENT_DIR}…"
  rm -rf "$AGENT_DIR" 2>/dev/null || true

  echo ""
  echo -e "${C_GREEN}${C_BOLD}  ──────────────────────────────────────────────"
  echo -e "   🧹  RavenCore agent fully removed from this VPS"
  echo -e "  ──────────────────────────────────────────────${C_RESET}"
  echo ""
  echo -e "  Pterodactyl and all other containers were left untouched."
  echo -e "  Last step: delete the node from the panel → Admin → Nodes → Delete."
  echo ""
}

# ── Flag dispatch ─────────────────────────────────────────────────
case "$1" in
  --update) update_agent; exit 0 ;;
  --delete) delete_agent; exit 0 ;;
esac

# ── Root check ────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  fail "Please run this script as root:  sudo bash <(curl -fsSL ...)"
fi

echo ""
echo -e "${C_BOLD}${C_CYAN}  ╔══════════════════════════════════════════════╗"
echo -e "  ║     RavenCore Panel — Node Installer        ║"
echo -e "  ║     Connect this VPS to your panel         ║"
echo -e "  ╚══════════════════════════════════════════════╝${C_RESET}"
echo ""

# ── If the agent is already installed, offer a menu ──────────────
if [ -f "/opt/raven-agent/docker-compose.yml" ]; then
  echo -e "  ${C_CYAN}RavenCore agent is already installed on this VPS.${C_RESET}"
  echo ""
  echo -e "  ${C_BOLD}1)${C_RESET} Update the agent (re-download + rebuild)"
  echo -e "  ${C_BOLD}2)${C_RESET} Delete the agent (remove everything RavenCore, keeps other apps)"
  echo -e "  ${C_BOLD}3)${C_RESET} Reinstall (connect to the panel again)"
  echo -e "  ${C_BOLD}q)${C_RESET} Quit"
  echo ""
  read -rp "  Choose: " CHOICE
  case "$CHOICE" in
    1) update_agent; exit 0 ;;
    2) delete_agent; exit 0 ;;
    3) echo "" ;;
    *) exit 0 ;;
  esac
fi

# ── Ask questions (with smart defaults) ──────────────────────────
read -rp "  Panel URL: " PANEL_URL
PANEL_URL="${PANEL_URL%/}"
[ -z "$PANEL_URL" ] && fail "Panel URL is required."

echo ""
echo -e "  ${C_YELLOW}Application API key:${C_RESET}"
echo -e "  Create one in your panel:  Admin → Application API → New Key"
echo -e "  Give it the ${C_BOLD}node:create${C_RESET} permission (or just select all)."
read -rp "  Paste the key (starts with ptla_): " API_KEY
[ -z "$API_KEY" ] && fail "API key is required."

read -rp "  Node name (e.g. Node-02): " NODE_NAME
[ -z "$NODE_NAME" ] && NODE_NAME="Node-$(hostname | tr -cd 'a-zA-Z0-9' | head -c 8)"

# Auto-detect FQDN: prefer a real hostname, fall back to public IP
DETECTED_FQDN="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo '')"
PUBLIC_IP="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo '')"
if [ -z "$DETECTED_FQDN" ] || [ "$DETECTED_FQDN" = "localhost" ]; then
  DETECTED_FQDN="$PUBLIC_IP"
fi
read -rp "  Node FQDN / IP (players connect here) [${DETECTED_FQDN}]: " NODE_FQDN
[ -z "$NODE_FQDN" ] && NODE_FQDN="$DETECTED_FQDN"

read -rp "  Agent port (default 8080): " AGENT_PORT
[ -z "$AGENT_PORT" ] && AGENT_PORT=8080

read -rp "  SFTP port (default 2022): " SFTP_PORT
[ -z "$SFTP_PORT" ] && SFTP_PORT=2022

# Auto-detect resources
TOTAL_MEM_MB="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
TOTAL_DISK_MB="$(df -B1 / 2>/dev/null | awk 'NR==2 {printf "%d", $2/1024/1024}' || echo 0)"
TOTAL_CPU="$(nproc 2>/dev/null || echo 1)"
read -rp "  RAM to give the node in MB [${TOTAL_MEM_MB}]: " NODE_MEM
[ -z "$NODE_MEM" ] && NODE_MEM="$TOTAL_MEM_MB"
read -rp "  Disk to give the node in MB [${TOTAL_DISK_MB}]: " NODE_DISK
[ -z "$NODE_DISK" ] && NODE_DISK="$TOTAL_DISK_MB"
read -rp "  CPU cores to give the node [${TOTAL_CPU}]: " NODE_CPU
[ -z "$NODE_CPU" ] && NODE_CPU="$TOTAL_CPU"

read -rp "  Server data directory [/var/lib/raven/bots]: " DATA_DIR
[ -z "$DATA_DIR" ] && DATA_DIR="/var/lib/raven/bots"

echo ""
info "Registering node \"${NODE_NAME}\" with ${PANEL_URL}…"

# ── Register the node with the panel ──────────────────────────────
REGISTER_JSON=$(cat <<EOF
{"name":"${NODE_NAME}","fqdn":"${NODE_FQDN}","port":${AGENT_PORT},"scheme":"http","memory_mb":${NODE_MEM:-0},"disk_mb":${NODE_DISK:-0},"cpu_cores":${NODE_CPU:-0},"file_directory":"${DATA_DIR}","sftp_port":${SFTP_PORT}}
EOF
)

RESPONSE="$(curl -fsSL --max-time 20 -X POST "${PANEL_URL}/api/admin/nodes/register" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$REGISTER_JSON" 2>/dev/null)" || {
  # Show the actual error so users know if it's a network or permission issue
  ERR_BODY="$(curl -sSL --max-time 20 -X POST "${PANEL_URL}/api/admin/nodes/register" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$REGISTER_JSON" 2>/dev/null)"
  if [ -n "$ERR_BODY" ]; then
    fail "Registration rejected by the panel: $ERR_BODY"
  else
    fail "Could not reach the panel at ${PANEL_URL}. Check the URL, and make sure the API key has the node:create permission."
  fi
}

DAEMON_TOKEN="$(echo "$RESPONSE" | sed -n 's/.*"daemon_token":"\([^"]*\)".*/\1/p')"
if [ -z "$DAEMON_TOKEN" ]; then
  fail "Registration failed. Response: $RESPONSE"
fi
ok "Node registered! (daemon token received)"

# ── Install Docker ────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker… (this can take a minute)"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1 || fail "Docker install failed. Install it manually: https://get.docker.com"
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker installed"
else
  ok "Docker already installed"
fi

# Detect docker compose (v2 plugin) vs docker-compose (v1)
COMPOSE=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  fail "Docker Compose is not installed. Install it: https://docs.docker.com/compose/install/"
fi
ok "Using: ${COMPOSE}"

# ── Download the agent ────────────────────────────────────────────
AGENT_DIR="/opt/raven-agent"
info "Downloading the RavenCore agent…"
mkdir -p "$AGENT_DIR"
TARBALL="$(mktemp)"
curl -fsSL --max-time 120 -o "$TARBALL" "$REPO_TARBALL" \
  || fail "Could not download the agent source."
tar -xzf "$TARBALL" -C "$AGENT_DIR" --strip-components=1 2>/dev/null \
  || fail "Could not extract the agent source."
rm -f "$TARBALL"
ok "Agent source downloaded"

# ── Write agent config + compose ──────────────────────────────────
mkdir -p "$DATA_DIR"
cat > "$AGENT_DIR/docker-compose.yml" <<EOF
services:
  agent:
    build: ./agent
    restart: unless-stopped
    ports:
      - "${AGENT_PORT}:8080"
      - "${SFTP_PORT}:${SFTP_PORT}"
    environment:
      NODE_OPTIONS: --max-old-space-size=256
      AGENT_TOKEN: ${DAEMON_TOKEN}
      CONSOLE_SECRET: ${DAEMON_TOKEN}
      BOT_DATA_DIR: ${DATA_DIR}
      SFTP_PORT: ${SFTP_PORT}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${DATA_DIR}:${DATA_DIR}
    mem_limit: 512m
    logging:
      driver: json-file
      options:
        max-size: "5m"
        max-file: "2"
EOF

# ── Start the agent ───────────────────────────────────────────────
info "Building and starting the agent… (first build takes a few minutes)"
cd "$AGENT_DIR"
if ! $COMPOSE up -d --build --remove-orphans 2>&1 | tee /tmp/raven-agent-build.log | tail -20; then
  echo ""
  fail "Agent build/start failed. Last build output above — or run: cd /opt/raven-agent && ${COMPOSE} logs agent"
fi
# Verify the container is actually running (compose can exit 0 even when a
# container fails to start, e.g. a port is already in use)
sleep 4
if ! $COMPOSE ps agent 2>/dev/null | grep -q 'Up'; then
  echo ""
  echo -e "${C_RED}  The agent container is not running. Last logs:${C_RESET}"
  $COMPOSE logs --tail 20 agent 2>&1 || true
  echo ""
  fail "Agent failed to start. Common cause: a port is already in use."
fi
ok "Agent is running!"

# ── Firewall ─────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${AGENT_PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow "${SFTP_PORT}/tcp" >/dev/null 2>&1 || true
  ok "Firewall rules added (agent port + SFTP port)"
fi

echo ""
echo -e "${C_GREEN}${C_BOLD}  ──────────────────────────────────────────────"
echo -e "   🎉  Node connected successfully!"
echo -e "  ──────────────────────────────────────────────${C_RESET}"
echo ""
echo -e "  ${C_BOLD}Node:${C_RESET}      ${NODE_NAME}"
echo -e "  ${C_BOLD}FQDN:${C_RESET}      ${NODE_FQDN}"
echo -e "  ${C_BOLD}Agent port:${C_RESET} ${AGENT_PORT}"
echo -e "  ${C_BOLD}SFTP port:${C_RESET}  ${SFTP_PORT}"
echo -e "  ${C_BOLD}Data dir:${C_RESET}  ${DATA_DIR}"
echo ""
echo -e "  Next steps:"
echo -e "   1. Open your panel → Admin → Nodes → you should see ${C_BOLD}${NODE_NAME}${C_RESET} online."
echo -e "   2. Add allocations (ports) to the node so servers can be created on it."
echo -e "   3. Create a server and pick this node!"
echo ""
echo -e "  Useful commands:"
echo -e "   Logs:    cd /opt/raven-agent && ${COMPOSE} logs -f agent"
echo -e "   Restart: cd /opt/raven-agent && ${COMPOSE} restart agent"
echo -e "   Remove:  cd /opt/raven-agent && ${COMPOSE} down"
echo ""
