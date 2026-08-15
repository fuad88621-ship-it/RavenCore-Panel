# RavenCore Panel

> One-command installer for **RavenCore Panel** — a modern, self-hosted hosting panel for Discord bots, game servers, and applications. Think of it as the Pterodactyl alternative that ships with a cleaner UI, simpler node setup, and a single bash installer.

[![Install](https://img.shields.io/badge/Install-1%20command-violet)](https://github.com/fuad88621-ship-it/RavenCore-Panel#installation)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

---

## Table of Contents

- [What is RavenCore?](#what-is-ravencore)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Quick Install](#quick-install)
  - [Installer Menu Options](#installer-menu-options)
- [Post-Install Setup](#post-install-setup)
  - [Default URLs](#default-urls)
  - [Creating the First Admin](#creating-the-first-admin)
  - [Environment Variables](#environment-variables)
- [Configuration](#configuration)
  - [`config.yml`](#configyml)
  - [`docker-compose.yml`](#docker-composeyml)
  - [`Caddyfile`](#caddyfile)
- [How to Create a Node](#how-to-create-a-node)
  - [Local Node (same machine)](#local-node-same-machine)
  - [Remote Node](#remote-node)
- [How to Create a Server](#how-to-create-a-server)
- [Application API Keys](#application-api-keys)
- [Backups & Databases](#backups--databases)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

---

## What is RavenCore?

RavenCore is a container-based hosting panel. It lets you run and manage Discord bots, game servers, or any other application inside Docker containers from a web dashboard.

It is split into two parts:

| Component | What it does | Docker service |
|-----------|--------------|----------------|
| **Panel** | Web UI, API, auth, database management | `raven-panel` |
| **Agent** | Runs on the host that actually executes containers | `raven-agent` |

The Panel and Agent can live on the same machine, or you can connect remote Agents to one Panel.

---

## Features

- 🎛️ Modern dark dashboard with bento-grid layout
- 🐳 Docker-based server isolation
- 🌍 Multi-node support (local + remote agents)
- 🔐 Built-in auth, admin roles, and API keys
- 💾 Automatic backups
- 🗄️ Per-server MySQL databases
- 🚀 One-command installer with interactive menu
- 🖥️ Browser console for each server
- 📦 Pre-built eggs (Node.js, Python, Go, Java, Minecraft Paper, Minecraft Vanilla)

---

## Requirements

- A Linux server (Ubuntu 22.04/24.04 recommended, Debian works too)
- Root or sudo access
- At least **2 CPU cores**, **4 GB RAM**, **20 GB disk** (more for actual workloads)
- A domain name pointing at your server (for SSL)
- Ports `80` and `443` open (Caddy handles SSL automatically)
- Port `2022` open if you want SFTP access to servers

---

## Installation

### Quick Install

**One command for everything** — run on any VPS:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
```

First run shows a menu:

```
  1) Install Panel   — full panel on this VPS (caddy, DB, panel, agent)
  2) Install Agent   — connect this VPS to your panel as a node
  3) Delete Panel    — remove the panel from this VPS (keeps other apps)
  4) Delete Agent    — remove the agent from this VPS (keeps other apps)
  q) Quit
```

**Install Panel** asks for your panel domain, node domain, admin credentials and node resources, then installs Docker, configures container DNS, generates secrets, builds the stack and creates your admin account automatically.

**Install Agent** asks for your panel URL + API key, then connects this VPS as a node.

### ☁️ Cloudflare auto-DNS (zero manual DNS work)

The installer can create your DNS records automatically — you only need a **Cloudflare API token** and your domain. No touching DNS settings, no registrar, nothing.

**1. Get a Cloudflare API token (2 minutes):**

1. Log into [cloudflare.com](https://cloudflare.com) → top-right profile → **My Profile** → **API Tokens**
2. Click **Create Token** → use the **"Edit zone DNS"** template
3. **Permissions:** Zone → DNS → **Edit** (already set)
4. **Zone Resources:** Include → **Specific zone** → pick your domain
5. **Leave Client IP Filtering and TTL empty** (empty = works from anywhere, never expires)
6. Click **Continue → Create Token** → **copy the token** (shown once — save it)

**2. Run the installer and say yes to Cloudflare:**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
```

Pick **1) Install Panel**, then when asked:

```
Use Cloudflare to auto-create DNS records? [y/N]: y
Cloudflare API token: ****************
Your domain (e.g. ravenshop.store): ravenshop.store
```

The installer then **automatically**:
- Creates `panel.<your-domain>` → your VPS IP (A record)
- Creates `node.<your-domain>` → your VPS IP (A record)
- Waits for DNS propagation
- Installs the whole panel with those domains

That's it — panel live, DNS done, admin created. (Manual DNS is still supported — just say **n** and enter your domains.)

### Direct commands (no menu, for scripting)

| Command | What it does |
|---------|--------------|
| `install.sh --install-panel` | Install the full panel |
| `install.sh --install-agent` | Connect this VPS as a node |
| `install.sh --update` | Re-download + rebuild the agent |
| `install.sh --delete` | Remove the agent (keeps other apps) |
| `install.sh --uninstall-panel` | Remove the panel (keeps other apps) |

### Installer Menu Options

`install-panel.sh` (the panel installer) asks:

| Question | What it's for |
|----------|---------------|
| **Panel domain** | Where users log in (e.g. `panel.example.com`) |
| **Node domain** | Only used for the browser console WebSocket (e.g. `node.example.com`) |
| **Admin email / username / password** | Your first admin account (blank password = random) |
| **Node name / memory / disk / CPU** | Resources for the local node |

Re-running `install-panel.sh` on the same VPS updates the panel (git pull + rebuild, keeps your `.env` and data).

`install.sh` (the node installer) shows a menu when the agent is already installed:

```
  1) Update the agent (re-download + rebuild)
  2) Delete the agent (remove everything RavenCore, keeps other apps)
  3) Reinstall (connect to the panel again)
  4) Uninstall the panel (only if this VPS IS the panel — removes everything)
  q) Quit
```

---

## Post-Install Setup

### Default URLs

After the installer finishes:

- **Panel:** `https://panel.yourdomain.com`
- **Node console:** `https://node.yourdomain.com`

> Replace `yourdomain.com` with the domain you configured in `config.yml`.

### Creating the First Admin

`install-panel.sh` creates your admin account automatically (it registers the user and promotes them to `root_admin`).

If you need to create or promote an admin manually later:

```bash
cd /opt/raven
# register the user through the panel's own API
curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"you@example.com","password":"YourPass123"}'
# promote to admin
docker exec raven-postgres-1 psql -U raven -d raven -c \
  "UPDATE users SET root_admin = true WHERE email = 'you@example.com';"
```

### Environment Variables

The installer creates `/opt/raven/.env` with random values. You normally don't need to touch it, but here is what each variable does:

| Variable | Purpose |
|----------|---------|
| `DB_PASSWORD` | Password used by PostgreSQL and MariaDB |
| `SESSION_SECRET` | Used to sign user session cookies |
| `AGENT_TOKEN` | Shared secret between Panel and Agent (auto-generated) |
| `CONSOLE_SECRET` | Secret used for websocket console sessions |

---

## Configuration

All configuration files live in `/opt/raven`.

### `config.yml`

Main configuration file. Key sections:

```yaml
app:
  name: Raven Panel
  description: Discord bot hosting panel
  url: https://panel.yourdomain.com   # Panel URL
  timezone: UTC
  locale: en

panel:
  port: 3000   # Internal port, Caddy proxies to this

node:
  name: Node-01
  fqdn: node.yourdomain.com
  port: 8080
  memory_mb: 7680       # Total memory this node can allocate
  disk_mb: 80000        # Total disk this node can allocate
  cpu_cores: 4
  memory_overallocate: 0
  disk_overallocate: 0
  cpu_overallocate: 0

security:
  session_secret: ${SESSION_SECRET}
  agent_token: ${AGENT_TOKEN}       # Used for Panel ↔ Agent auth
  console_secret: ${CONSOLE_SECRET}
  rate_limit: 20
```

### `docker-compose.yml`

Defines all services: panel, agent, postgres, redis, mariadb, caddy.

### `Caddyfile`

Reverse proxy config. It handles SSL automatically with Let's Encrypt. The node domain is **only** for the browser console WebSocket — everything else on it returns 404 (the agent API itself stays internal).

```caddy
panel.yourdomain.com {
    reverse_proxy panel:3000
}

node.yourdomain.com {
    @ws path_regexp ^/servers/[0-9a-f-]+/ws$
    reverse_proxy @ws agent:8080
    @notws not path_regexp ^/servers/[0-9a-f-]+/ws$
    respond @notws 404
}
```

`install-panel.sh` generates this file from your domains automatically.

After editing any config file, restart services:

```bash
cd /opt/raven
docker compose up -d --build
```

---

## How to Create a Node

A **Node** is a machine that runs containers. Every server must belong to a node.

### Local Node (same machine)

If you installed Panel + Agent on the same machine, a node called `Node-01` is created automatically. You don't need to do anything.

### Remote Node

1. On the remote VPS, run the node installer:
   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
   ```
2. It asks for your **Panel URL** and a **daemon token** — create the token in the Panel under **Admin → Nodes → New Node** (or use an existing node's token). The node registers itself with the panel automatically.
3. In the Panel, go to **Admin → Nodes** and check the new node is online.
4. Go into the node, then **Allocations**, and add ports the server can use (e.g. `25565-25575`).

---

## How to Create a Server

1. In the Panel, click **Create Server**.
2. Pick a **Node** and a **Location**.
3. Choose an **Egg** (Node.js, Python, Go, Java, or custom).
4. Set limits: memory, disk, CPU.
5. Choose how many **allocations** (ports) the server needs.
6. Click **Create**.

The server will install and start automatically. You can manage it from the server detail page.

---

## Application API Keys

API keys let external tools talk to the Panel API.

1. Go to **Admin → API Keys**.
2. Click **Create API Key**.
3. Give it a description and permissions.
4. Copy the key — it is shown only once.

Use it in requests:

```bash
curl -H "Authorization: Bearer ptla_xxxxxxxxxx" \
     https://panel.yourdomain.com/api/admin/overview
```

---

## Backups & Databases

- **Backups:** Each server can be backed up from its detail page.
- **Databases:** When creating or editing a server, you can request MySQL databases. Raven creates a database and user automatically in MariaDB.

---

## Updating

**Panel:** re-run the panel installer — it detects the existing install and offers to update:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install-panel.sh)
# answer "y" when it asks to update
```

**Nodes:**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh) --update
```

---

## Troubleshooting

### Panel shows a 502 error

Caddy started before the Panel was ready. Wait 30 seconds and refresh.

### Agent shows as offline

1. Check the Agent logs:
   ```bash
   cd /opt/raven
   docker compose logs -f agent
   ```
2. Make sure the Panel's `AGENT_TOKEN` matches the Agent's `AGENT_TOKEN` in `/opt/raven/.env`.
3. Make sure `node.fqdn` in `config.yml` points to the Agent's public domain and port `8080` is open.

### Forgot admin password

Reset it via the database:

```bash
cd /opt/raven
docker exec raven-panel-1 node -e "
const bcrypt = require('bcryptjs');
const { pool } = require('./src/db.js');
const hash = bcrypt.hashSync('NEW_PASSWORD', 10);
pool.query('UPDATE users SET password_hash = \$1 WHERE username = \$2', [hash, 'YOUR_USERNAME']).then(() => console.log('Done'));
"
```

### Can't register because registration is disabled

Registration is enabled by default. If disabled, create the first user directly in the database or re-enable it in **Admin → Settings**.

---

## Uninstall

**Remove the whole panel** (panel, database, all bots, everything — cannot be undone):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh) --uninstall-panel
# type DELETE to confirm
```

**Remove just a node** (keeps other apps on that VPS):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh) --delete
```

---

## License

MIT — do whatever you want, just don't blame us if you blow up a VPS.

---

## Need Help?

Open an issue on this repo. Include:

- Your OS and version
- The output of `docker compose logs`
- What you were trying to do
