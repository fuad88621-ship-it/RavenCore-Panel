#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  RavenCore Panel — Node Installer
#  Run this on a NEW VPS to connect it to your panel as a node.
#
#    bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
#
#  It will ask you a few simple questions (panel URL, API key, how much
#  RAM/disk/CPU to give the node) and do everything else automatically:
#  install Docker, register the node with your panel, install the agent,
#  and start it. No technical knowledge needed.
# ═══════════════════════════════════════════════════════════════════

set -e

# ── Colors ─────────────────────────────────────────────────────────
C_RESET='\033[0m'; C_GREEN='\033[32m'; C_CYAN='\033[36m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_BOLD='\033[1m'

info()  { echo -e "${C_CYAN}[i]${C_RESET} $1"; }
ok()    { echo -e "${C_GREEN}[✓]${C_RESET} $1"; }
warn()  { echo -e "${C_YELLOW}[!]${C_RESET} $1"; }
fail()  { echo -e "${C_RED}[✗]${C_RESET} $1"; exit 1; }

# ── Root check ─────────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  fail "Please run this script as root:  sudo bash <(curl -fsSL ...)"
fi

echo ""
echo -e "${C_BOLD}${C_CYAN}  ╔══════════════════════════════════════════════╗"
echo -e "  ║     RavenCore Panel — Node Installer        ║"
echo -e "  ║     Connect this VPS to your panel         ║"
echo -e "  ╚══════════════════════════════════════════════╝${C_RESET}"
echo ""

# ── Ask questions (with smart defaults) ──────────────────────────
read -rp "  Panel URL (e.g. https://panel.ravenshop.store): " PANEL_URL
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
{"name":"${NODE_NAME}","fqdn":"${NODE_FQDN}","port":${AGENT_PORT},"scheme":"http","memory_mb":${NODE_MEM:-0},"disk_mb":${NODE_DISK:-0},"cpu_cores":${NODE_CPU:-0},"file_directory":"${DATA_DIR}"}
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
curl -fsSL --max-time 120 -o "$TARBALL" \
  "https://github.com/fuad88621-ship-it/RavenCore-Panel/archive/refs/heads/main.tar.gz" \
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
      - "2022:2022"
    environment:
      NODE_OPTIONS: --max-old-space-size=256
      AGENT_TOKEN: ${DAEMON_TOKEN}
      CONSOLE_SECRET: ${DAEMON_TOKEN}
      BOT_DATA_DIR: ${DATA_DIR}
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
if ! $COMPOSE up -d --build 2>&1 | tee /tmp/raven-agent-build.log | tail -20; then
  echo ""
  fail "Agent failed to start. Last build output above — or run: cd /opt/raven-agent && ${COMPOSE} logs agent"
fi
ok "Agent is running!"

# ── Firewall ─────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${AGENT_PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow 2022/tcp >/dev/null 2>&1 || true
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
