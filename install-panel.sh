#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  RavenCore Panel — FULL PANEL INSTALLER
#  Run this on a FRESH VPS to set up the entire panel (caddy, postgres,
#  redis, mariadb, panel, agent) with one command:
#
#    bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install-panel.sh)
#
#  It installs Docker, configures container DNS, downloads the panel,
#  generates secrets + Caddyfile from your domain, builds the stack and
#  creates your admin account. Re-running it updates the panel.
# ═══════════════════════════════════════════════════════════════════

set -e
set -o pipefail

# ── Self-materialize: if run via `bash <(curl ...)`, save to a real file and
# re-exec from it (same trick as install.sh — the /dev/fd pipe can't be re-read).
if [[ "$0" == /dev/fd/* ]] || [[ "$0" == /proc/self/fd/* ]]; then
  SELF_URL="https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install-panel.sh"
  TMP="$(mktemp /tmp/raven-panel-install.XXXXXX.sh)"
  curl -fsSL "$SELF_URL" -o "$TMP" || { echo "Could not re-download installer"; exit 1; }
  exec bash "$TMP" "$@"
fi

# ── Colors + helpers ────────────────────────────────────────────────
C_RESET='\033[0m'; C_GREEN='\033[32m'; C_CYAN='\033[36m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_BOLD='\033[1m'

info()  { echo -e "${C_CYAN}[i]${C_RESET} $1"; }
ok()    { echo -e "${C_GREEN}[✓]${C_RESET} $1"; }
warn()  { echo -e "${C_YELLOW}[!]${C_RESET} $1"; }
fail()  { echo -e "${C_RED}[✗]${C_RESET} $1"; exit 1; }

# Random hex secret — falls back to /dev/urandom if openssl is missing.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    tr -dc 'a-f0-9' < /dev/urandom | head -c "$(( $1 * 2 ))"
  fi
}

PANEL_DIR="/opt/raven"
REPO_URL="https://github.com/fuad88621-ship-it/RavenCore-Panel.git"

# ── Root check ─────────────────────────────────────────────────────
[ "$(id -u)" = "0" ] || fail "Run as root (sudo su -)."

echo ""
echo -e "${C_CYAN}${C_BOLD}  ╔══════════════════════════════════════════════════════╗"
echo -e "  ║        RavenCore Panel — full panel installer          ║"
echo -e "  ╚══════════════════════════════════════════════════════╝${C_RESET}"
echo ""

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

# ── Fix container DNS ──────────────────────────────────────────────
# Same fix as install.sh: pin the Docker daemon to real upstream resolvers
# so containers don't inherit a broken 127.0.0.53 systemd-resolved stub.
info "Configuring Docker DNS…"
UPSTREAM_DNS="$(resolvectl status 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | sort -u | head -2 | tr '\n' ' ')"
if [ -z "$UPSTREAM_DNS" ]; then
  UPSTREAM_DNS="8.8.8.8 1.1.1.1"
fi
DNS_JSON="$(echo "$UPSTREAM_DNS" | awk '{for(i=1;i<=NF;i++) printf "\"%s\"%s", $i, (i<NF?",":"")}')"
if command -v python3 >/dev/null 2>&1 && [ -f /etc/docker/daemon.json ]; then
  python3 - "$DNS_JSON" <<'PY'
import json, sys
dns = [x.strip('"') for x in sys.argv[1].split(',')]
p = '/etc/docker/daemon.json'
try:
    with open(p) as f: cfg = json.load(f)
except Exception:
    cfg = {}
cfg['dns'] = dns
with open(p, 'w') as f: json.dump(cfg, f, indent=2)
PY
else
  echo "{\"dns\": [$DNS_JSON]}" > /etc/docker/daemon.json
fi
systemctl restart docker >/dev/null 2>&1 || true
ok "Docker DNS configured ($UPSTREAM_DNS)"

# ── Existing install? offer update ─────────────────────────────────
if [ -f "$PANEL_DIR/docker-compose.yml" ]; then
  echo ""
  echo -e "  ${C_CYAN}A panel already exists at ${PANEL_DIR}.${C_RESET}"
  read -rp "  Update it? (git pull + rebuild, keeps your .env and data) [y/N]: " UPD
  if [ "$UPD" = "y" ] || [ "$UPD" = "Y" ]; then
    info "Updating panel…"
    cd "$PANEL_DIR"
    # The generated Caddyfile (user's domains) is a tracked file with local
    # changes — git pull would fail on it. Preserve it across the update.
    cp Caddyfile /tmp/raven-caddyfile.bak 2>/dev/null || true
    git checkout -- Caddyfile 2>/dev/null || true
    git pull --ff-only 2>/dev/null || warn "git pull failed — continuing with existing source"
    cp /tmp/raven-caddyfile.bak Caddyfile 2>/dev/null || true
    ${COMPOSE} up -d --build
    ok "Panel updated."
    exit 0
  fi
  exit 0
fi

# ── Port check ────────────────────────────────────────────────────
if ss -tln 2>/dev/null | grep -qE ':(80|443) '; then
  warn "Port 80/443 is already in use — Caddy may fail to bind. Stop the other web server first."
fi

# ── Questions ──────────────────────────────────────────────────────
echo ""
echo -e "  ${C_BOLD}Domain setup${C_RESET} — both domains must point to this VPS (A records)."
read -rp "  Panel domain (e.g. panel.example.com): " PANEL_DOMAIN
[ -z "$PANEL_DOMAIN" ] && fail "Panel domain is required."
DEFAULT_NODE="node.${PANEL_DOMAIN#*.}"
read -rp "  Node domain (default: ${DEFAULT_NODE}): " NODE_DOMAIN
[ -z "$NODE_DOMAIN" ] && NODE_DOMAIN="$DEFAULT_NODE"

echo ""
echo -e "  ${C_BOLD}Admin account${C_RESET}"
read -rp "  Admin email: " ADMIN_EMAIL
[ -z "$ADMIN_EMAIL" ] && fail "Admin email is required."
read -rp "  Admin username (default: admin): " ADMIN_USER
[ -z "$ADMIN_USER" ] && ADMIN_USER="admin"
read -rsp "  Admin password (blank = random): " ADMIN_PASS
echo ""
if [ -z "$ADMIN_PASS" ]; then
  ADMIN_PASS="$(gen_secret 8 | head -c 16)"
  warn "Generated admin password: ${ADMIN_PASS}"
fi

echo ""
echo -e "  ${C_BOLD}Local node resources${C_RESET} (this VPS becomes your first node)"
read -rp "  Node name (default: Node-01): " NODE_NAME
[ -z "$NODE_NAME" ] && NODE_NAME="Node-01"
read -rp "  Memory MB (default: 7680): " NODE_MEMORY_MB
[ -z "$NODE_MEMORY_MB" ] && NODE_MEMORY_MB="7680"
read -rp "  Disk MB (default: 80000): " NODE_DISK_MB
[ -z "$NODE_DISK_MB" ] && NODE_DISK_MB="80000"
read -rp "  CPU cores (default: 4): " NODE_CPU_CORES
[ -z "$NODE_CPU_CORES" ] && NODE_CPU_CORES="4"

# ── DNS check (warn only — DNS may still be propagating) ──────────
VPS_IP="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo '')"
if [ -n "$VPS_IP" ] && command -v dig >/dev/null 2>&1; then
  DNS_IP="$(dig +short "$PANEL_DOMAIN" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)"
  if [ -n "$DNS_IP" ] && [ "$DNS_IP" != "$VPS_IP" ]; then
    warn "DNS for ${PANEL_DOMAIN} points to ${DNS_IP}, but this VPS is ${VPS_IP}. Fix the A record or HTTPS will fail."
  fi
fi

# ── Download the panel source ─────────────────────────────────────
info "Downloading RavenCore…"
if ! command -v git >/dev/null 2>&1; then
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq git >/dev/null 2>&1 || fail "git is required. Install it: apt-get install -y git"
fi
git clone --depth 1 "$REPO_URL" "$PANEL_DIR" 2>/dev/null || fail "Could not clone the repo. Check network access to GitHub."
ok "Source downloaded to ${PANEL_DIR}"

# ── Generate .env ─────────────────────────────────────────────────
info "Generating secrets…"
DB_PASSWORD="$(gen_secret 16)"
SESSION_SECRET="$(gen_secret 32)"
AGENT_TOKEN="$(gen_secret 32)"
CONSOLE_SECRET="$(gen_secret 32)"
cat > "$PANEL_DIR/.env" <<EOF
DB_PASSWORD=${DB_PASSWORD}
SESSION_SECRET=${SESSION_SECRET}
AGENT_TOKEN=${AGENT_TOKEN}
CONSOLE_SECRET=${CONSOLE_SECRET}
PANEL_URL=https://${PANEL_DOMAIN}
NODE_URL=https://${NODE_DOMAIN}
NODE_FQDN=${NODE_DOMAIN}
NODE_NAME=${NODE_NAME}
NODE_MEMORY_MB=${NODE_MEMORY_MB}
NODE_DISK_MB=${NODE_DISK_MB}
NODE_CPU_CORES=${NODE_CPU_CORES}
EOF
ok ".env written (secrets generated)"

# ── Generate Caddyfile ─────────────────────────────────────────────
cat > "$PANEL_DIR/Caddyfile" <<EOF
${PANEL_DOMAIN} {
	reverse_proxy panel:3000
}

# ${NODE_DOMAIN} is ONLY for the browser console WebSocket.
# The full agent API is never exposed publicly — the panel talks to the
# agent over the internal Docker network instead.
${NODE_DOMAIN} {
	@ws path_regexp ^/servers/[0-9a-f-]+/ws$
	reverse_proxy @ws agent:8080
	@notws not path_regexp ^/servers/[0-9a-f-]+/ws$
	respond @notws 404
}
EOF
ok "Caddyfile written (${PANEL_DOMAIN} + ${NODE_DOMAIN})"

# ── Build + start ─────────────────────────────────────────────────
info "Building + starting the panel (first build takes a few minutes)…"
cd "$PANEL_DIR"
${COMPOSE} up -d --build
ok "Stack started"

# ── Wait for the panel to be ready ────────────────────────────────
info "Waiting for the panel to boot…"
PANEL_UP=0
for i in $(seq 1 60); do
  if docker exec raven-panel-1 node -e "fetch('http://localhost:3000/api/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    PANEL_UP=1
    break
  fi
  sleep 5
done
[ "$PANEL_UP" = "1" ] || fail "Panel did not come up in 5 minutes. Check: cd ${PANEL_DIR} && ${COMPOSE} logs panel"
ok "Panel is up"

# ── Create the admin user ─────────────────────────────────────────
info "Creating admin user…"
docker exec raven-panel-1 node -e "
const [u, e, p] = process.argv.slice(1);
fetch('http://localhost:3000/api/auth/register', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({username: u, email: e, password: p})
}).then(async r => {
  const t = await r.text();
  if (!r.ok) { console.error('register failed:', t); process.exit(1); }
  console.log('registered');
}).catch(e => { console.error(e.message); process.exit(1); });
" "$ADMIN_USER" "$ADMIN_EMAIL" "$ADMIN_PASS"
docker exec raven-postgres-1 psql -U raven -d raven -c "UPDATE users SET root_admin = true WHERE email = '$ADMIN_EMAIL';" >/dev/null
ok "Admin created (root_admin = true)"

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo -e "${C_GREEN}${C_BOLD}  ──────────────────────────────────────────────"
echo -e "   🎉  Raven panel is LIVE!"
echo -e "  ──────────────────────────────────────────────${C_RESET}"
echo ""
echo -e "  Panel:  https://${PANEL_DOMAIN}"
echo -e "  Login:  ${ADMIN_EMAIL} / ${ADMIN_PASS}"
echo ""
echo -e "  ${C_BOLD}Next steps:${C_RESET}"
echo -e "   • Make sure ${PANEL_DOMAIN} and ${NODE_DOMAIN} point to this VPS (A records)."
echo -e "   • The local node (${NODE_NAME}) auto-registered on first boot."
echo -e "   • Add more nodes: run install.sh on other VPSes."
echo -e "   • Update the panel later: re-run this script and pick Update."
echo ""
