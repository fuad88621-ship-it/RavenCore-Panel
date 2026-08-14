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
- 📦 Pre-built eggs (Node.js, Python, Go, Java)

---

## Requirements

- A Linux server (Ubuntu 22.04/24.04 recommended, Debian works too)
- Root or sudo access
- At least **2 CPU cores**, **4 GB RAM**, **20 GB disk** (more for actual workloads)
- A domain name pointing at your server (for SSL)
- Ports `80` and `443` open (Caddy handles SSL automatically)
- Port `8080` open if you run the Agent on the same machine

---

## Installation

### Quick Install

Run this one command on a fresh VPS:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh)
```

You will see a menu like this:

```
═══════════════════════════════════════════════════
  RavenCore Panel Installer
═══════════════════════════════════════════════════

  [1] Install Panel
  [2] Install Agent (Wings)
  [3] Install Panel + Agent
  [4] Exit
```

Pick option `3` for a typical single-server setup.

### Installer Menu Options

| Option | Use when |
|--------|----------|
| **Install Panel** | You already have a separate Agent host and only need the web panel/API |
| **Install Agent** | You already have a Panel running elsewhere and want this machine to host containers |
| **Install Panel + Agent** | One machine does everything (recommended for most users) |

The installer will:

1. Update the system
2. Install Docker & Docker Compose plugin
3. Clone this repo to `/opt/raven`
4. Generate secure secrets in `/opt/raven/.env`
5. Build and start the selected services
6. Print your access URLs

---

## Post-Install Setup

### Default URLs

After the installer finishes:

- **Panel:** `https://panel.yourdomain.com`
- **Node console:** `https://node.yourdomain.com`

> Replace `yourdomain.com` with the domain you configured in `config.yml`.

### Creating the First Admin

1. Open the Panel URL in your browser.
2. Register a normal account.
3. SSH into the server and run:

```bash
cd /opt/raven
docker compose exec panel node -e "
const { pool } = require('./src/db.js');
pool.query(\"UPDATE users SET root_admin = true WHERE username = 'YOUR_USERNAME'\").then(() => console.log('Done')).catch(e => console.error(e));
"
```

> Replace `YOUR_USERNAME` with the username you registered.

Now refresh the page — you will have access to **Admin** in the sidebar.

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

Reverse proxy config. It handles SSL automatically with Let's Encrypt.

```caddy
panel.yourdomain.com {
    reverse_proxy panel:3000
}

node.yourdomain.com {
    reverse_proxy agent:8080
}
```

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

1. Install the Agent on the remote machine using the installer (option `2`).
2. In the Panel, go to **Admin → Nodes → New Node**.
3. Fill in the form:
   - **Name:** anything you want, e.g. `US-East-02`
   - **FQDN:** the remote agent's domain, e.g. `node2.yourdomain.com`
   - **Daemon Port:** `8080`
   - **SFTP Port:** `2022`
   - **Daemon Token:** leave empty to auto-generate, or paste the `AGENT_TOKEN` from the remote machine's `/opt/raven/.env`
4. Click **Register node**.
5. Go into the node, then **Allocations**, and add ports the server can use (e.g. `25565-25575`).

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

To update to the latest version:

```bash
cd /opt/raven
git pull
bash install.sh
```

Pick the same option you used before (usually `3`). The script will rebuild containers with the latest code.

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
docker compose exec panel node -e "
const bcrypt = require('bcryptjs');
const { pool } = require('./src/db.js');
const hash = bcrypt.hashSync('NEW_PASSWORD', 10);
pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, 'YOUR_USERNAME']).then(() => console.log('Done'));
"
```

### Can't register because registration is disabled

Registration is enabled by default. If disabled, create the first user directly in the database or re-enable it in **Admin → Settings**.

---

## Uninstall

This removes Raven and all its data. **This cannot be undone.**

```bash
cd /opt/raven
docker compose down -v
rm -rf /opt/raven
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
