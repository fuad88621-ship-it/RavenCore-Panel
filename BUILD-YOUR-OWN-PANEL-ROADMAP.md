# The "F*ck Pterodactyl, Build Your Own Discord Bot Host" Roadmap

*A human, step-by-step guide to building a dead-simple panel for hosting Discord bots — Python, Node.js, Java, Go, whatever. No Minecraft server BS. Just bots.*

---

## Why build this?

Pterodactyl is overkill for Discord bots. It was built for game servers with ports, maps, mods, player slots, and all that noise. For bots, you don't need 90% of it.

What you actually need:
- User signs up.
- User picks Python or Node or Java.
- User uploads `bot.py` or `index.js`.
- User clicks Start.
- Bot runs 24/7.
- User can see logs and restart it when it breaks.

That's the whole product.

But most "bot hosting" panels either:
- Look like garbage.
- Are hard to install.
- Charge way too much for what they are.

So build your own. Keep it lean. Keep it bot-focused. Make it install in one command.

This guide is the full roadmap from zero to a working bot host.

---

## What a Discord bot host actually does

When someone creates a bot on your platform, this happens:

1. They sign up.
2. They pick a plan (free, $2, $4, $8).
3. Your system picks a server (node) to run it on.
4. It creates an isolated container for their bot.
5. It installs the right runtime (Python, Node, Java, Go).
6. They upload or edit their code.
7. They start the bot.
8. The bot runs inside the container.
9. They see live logs in a console.
10. They can restart, stop, or edit env variables.

That's it. No ports. No allocations. No game server egg garbage. Just a bot in a box.

Your platform has three parts:

- **The Panel** — your website + API. The brain.
- **The Node Agent** — a small program on each server that runs the bots.
- **The Database** — users, bots, nodes, billing.

---

## Tech stack (keep it simple)

### Backend / API
- **Node.js + TypeScript** is perfect. Same language ecosystem as most bots.
- Use **Fastify** or **Express**.
- Sessions in **Redis** or signed cookies.

### Node Agent
- **Go** is ideal. One tiny binary, fast, low memory.
- **Node.js** works too if you want everything in one stack.
- The agent wraps **Docker**.

### Frontend
- **Next.js + React**.
- **Tailwind CSS** for styling.
- **xterm.js** for the console/logs.
- A simple code editor like **CodeMirror** or **Monaco** for editing files.

### Database
- **PostgreSQL** for main data.
- **Redis** for sessions, queues, stats caching.

### Container Runtime
- **Docker**. Non-negotiable. Every bot runs in its own container.
- Use **Docker Compose** for local dev.

### Reverse Proxy
- **Caddy** is easiest (auto HTTPS).
- **Nginx** if you like pain.

### Payments
- **OxaPay** for crypto.
- **Stripe** for cards/PayPal later.

---

## Phase 1: Boring foundation first

Don't touch the dashboard until this works.

### 1.1 User accounts

Build real email/password auth. Don't rely only on Discord OAuth.

- Sign up
- Log in
- Password reset
- Optional email verify

Use **bcrypt** or **Argon2**. Never plain text. I will find you.

User fields:
- `id` (UUID)
- `email`
- `password_hash`
- `role` (`user` or `admin`)
- `plan` (`free`, `starter`, `pro`, etc.)
- `discord_id` (link later for perks)
- `created_at`

### 1.2 Sessions

Use **signed session cookies + Redis**.

User logs in → you make a random token → store in Redis → send as cookie. To log them out everywhere, delete the token.

JWTs are fine but annoying to revoke. Cookies are simpler for dashboards.

### 1.3 Roles

Two roles:
- `admin` — sees everything.
- `user` — sees only their bots.

Add sub-users later if customers ask. Not day one.

### 1.4 Nodes

A **node** is a VPS/dedi that runs bots.

Node fields:
- `id`
- `name` (`FR-01`, `US-East-01`)
- `hostname` or IP
- `port` for agent
- `total_memory_mb`
- `total_disk_mb`
- `cpu_cores`
- `allocated_memory_mb`
- `allocated_disk_mb`
- `token` (secret between panel and agent)
- `enabled`

When someone creates a bot, pick the node with the most free RAM. Round-robin is fine to start.

### 1.5 Runtimes / "Eggs"

For Discord bots, you only need a few runtimes:

- **Python 3.11+** — `python:3.11-slim`
- **Node.js 20+** — `node:20-slim`
- **Java 17+** — `eclipse-temurin:17-jdk`
- **Go** — `golang:1.22`

Each runtime needs:
- `name`
- `docker_image`
- `startup_command` (e.g., `python bot.py`, `node index.js`, `java -jar bot.jar`)
- `install_command` (e.g., `pip install -r requirements.txt`, `npm install`)
- `default_limits`

No need for "eggs" with 50 variables. Just runtime templates.

---

## Phase 2: The Panel API

Build the API your dashboard talks to.

### 2.1 Create bot endpoint

`POST /api/bots`

```json
{
  "name": "My Music Bot",
  "runtime": "nodejs",
  "cpu": 60,
  "memory_mb": 512,
  "disk_mb": 1536
}
```

What it does:
1. Check user plan limits.
2. Pick a node with free resources.
3. Generate a unique ID for the bot.
4. Save bot to DB with status `installing`.
5. Tell the agent: "create this bot."
6. Return bot info immediately. Don't wait for install.

### 2.2 Bot model

Bot fields:
- `id`
- `identifier` (short ID like `abc123de`)
- `uuid` (long unique ID)
- `name`
- `user_id`
- `node_id`
- `runtime`
- `status` (`installing`, `offline`, `running`, `suspended`)
- `limits` (cpu, memory, disk)
- `container_id`
- `startup_command`
- `env` (key-value env vars)
- `created_at`

### 2.3 Power endpoints

`POST /api/bots/:id/power`

```json
{ "action": "start" }
```

Actions: `start`, `stop`, `restart`, `kill`.

Forward to agent. Agent talks to Docker.

### 2.4 Console credentials

`GET /api/bots/:id/console`

```json
{
  "socket": "wss://node.yourhost.com:8080/api/bots/uuid/ws",
  "token": "one-time-jwt"
}
```

Browser connects directly to agent WebSocket. Token expires in 5-10 minutes.

### 2.5 File manager

`GET /api/bots/:id/files?path=/`
`POST /api/bots/:id/files/read`
`POST /api/bots/:id/files/write`
`POST /api/bots/:id/files/delete`
`POST /api/bots/:id/files/rename`

Forward everything to the agent.

### 2.6 Env variables

`POST /api/bots/:id/env`

```json
{ "DISCORD_TOKEN": "abc", "PREFIX": "!" }
```

These get injected into the container as environment variables. This is how bots get their tokens without hardcoding them.

### 2.7 Resource usage

`GET /api/bots/:id/resources`

Returns CPU, RAM, disk usage. Poll this every 2-3s on the dashboard.

### 2.8 Admin endpoints

- List all users.
- List all bots.
- Suspend/unsuspend.
- Edit global settings (free slots, announcement, etc.).

---

## Phase 3: The Node Agent

This runs on every server and does the actual work.

### 3.1 Agent responsibilities

- Accept commands from the Panel.
- Create/delete/start/stop bot containers.
- Stream console logs via WebSocket.
- Handle file reads/writes.
- Report usage.

### 3.2 Panel → Agent auth

Shared secret token in `Authorization: Bearer <token>` header. Agent rejects anything without it.

Agent routes:
- `POST /bots` — create bot
- `DELETE /bots/:id` — delete bot
- `POST /bots/:id/power` — start/stop/restart/kill
- `POST /bots/:id/command` — send command to stdin
- `GET /bots/:id/files` — list files
- etc.

### 3.3 Creating a bot container

1. Make directory: `/var/lib/yourhost/bots/{uuid}/`
2. Pull runtime image.
3. Run install command inside a temp container:
   - Python: `pip install -r requirements.txt`
   - Node: `npm install`
   - Java: nothing usually
4. Create persistent container:
   ```bash
   docker run -d \
     --name {uuid} \
     --memory {memory}m \
     --cpus {cpu/100} \
     --restart unless-stopped \
     -v /var/lib/yourhost/bots/{uuid}:/app \
     -w /app \
     -e DISCORD_TOKEN=... \
     {image} \
     {startup_command}
   ```
5. Tell Panel: "installed, status offline."

### 3.4 Console / logs WebSocket

Agent exposes `wss://node.yourhost.com:8080/api/bots/:uuid/ws`.

When browser connects:
1. Validate JWT from Panel.
2. Attach to container stdout/stderr/stdin.
3. Stream logs to browser.
4. Read commands from browser, write to container stdin.

Use Docker's attach API or the Docker Engine SDK.

### 3.5 File manager

Agent reads/writes files in `/var/lib/yourhost/bots/{uuid}/`. Block any path with `..` or outside that directory.

### 3.6 Heartbeat

Agent pings Panel every 30-60s with:
```json
{
  "node_id": "fr-01",
  "online": true,
  "memory_used_mb": 12000,
  "memory_total_mb": 32000,
  "active_bots": 24
}
```

---

## Phase 4: Bot Lifecycle

### 4.1 Installing

User clicks Create. Status: `installing`.

Agent sets up the container and runs the install command. Panel shows "Installing…" with a spinner.

**Only admins can see live install logs.** Regular users just wait. That's how Pterodactyl works too — non-admins don't get install websocket access.

### 4.2 Offline

Container exists but isn't running. User can edit files, env vars, startup command.

### 4.3 Running

User clicks Start. Container runs. Logs stream. Stats update.

### 4.4 Stop / Kill

Stop = graceful SIGTERM. Kill = SIGKILL if it's stuck.

### 4.5 Reinstall

Wipe files and run install again. Useful if `node_modules` or `venv` gets corrupted.

### 4.6 Delete

Stop container, remove it, delete volume, remove DB record.

### 4.7 Suspend

Admin stops container and blocks starts until unsuspended.

---

## Phase 5: The Dashboard UI

### 5.1 Pages

- Landing page
- Login / Register
- Dashboard home
- Bots list
- Create bot
- Bot detail (console, files, env, settings)
- Store / Billing
- Settings
- Admin panel

### 5.2 Bot cards

Show:
- Name + status dot.
- Runtime badge (Python, Node, Java).
- Mini RAM/CPU bars.
- Start / Stop / Restart buttons.
- Manage button.

### 5.3 Console tab

Most important screen. Use **xterm.js**.

- Live logs.
- Command input.
- Connection status.
- Auto-scroll.
- Command history.

### 5.4 Files tab

Simple file manager. Let users:
- Upload `bot.py`, `index.js`, `requirements.txt`, `package.json`.
- Edit files in-browser.
- Delete/rename files.

### 5.5 Environment tab

A clean form for env variables. Most bot users only need:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- `PREFIX`
- `OWNER_ID`

Save and offer "Restart to apply."

### 5.6 Settings tab

- Rename bot.
- Change startup command.
- Reinstall.
- Delete bot (owner/admin only).

### 5.7 Admin panel

Clean tables:
- Users: email, plan, bots count, suspend/delete.
- Bots: name, owner, node, status, usage, suspend/delete.
- Nodes: name, online, RAM used/total, enable/disable.
- Settings: free slots, announcement banner, etc.

---

## Phase 6: Paid Plans & Billing

### 6.1 Plans

Example bot host plans:

| Plan | Price | RAM | Disk | CPU | Bots |
|------|-------|-----|------|-----|------|
| Free | $0 | 512MB | 1.5GB | 60% | 1 |
| Starter | $2 | 1GB | 5GB | 150% | 1 |
| Pro | $4 | 2GB | 10GB | 200% | 1 |
| Beast | $8 | 4GB | 20GB | 400% | 1 |

Keep it simple. One paid bot per plan. Don't do "slots" and "ports" and all that game host nonsense.

### 6.2 Payment flow

1. User picks plan.
2. Panel creates invoice.
3. User pays via OxaPay or Stripe.
4. Webhook hits Panel.
5. Panel upgrades user plan.
6. User can create a bigger bot or upgrade existing one.

### 6.3 Renewals

Store `plan_expires_at`. Run a daily job. If expired, downgrade to free or suspend the paid bot.

---

## Phase 7: One-Command Install

This is your killer feature. Make it stupid easy.

### 7.1 Install script

`install.sh` does:
1. Update system.
2. Install Docker, Docker Compose, Node.js, Caddy, Postgres, Redis.
3. Make directories.
4. Download Panel + Agent.
5. Generate secrets.
6. Start services.

```bash
curl -fsSL https://yourhost.com/install.sh | bash
```

### 7.2 Single config file

```yaml
panel:
  url: https://panel.yourhost.com
  port: 3000

database:
  host: localhost
  user: yourhost
  password: auto-generated
  name: yourhost

redis:
  host: localhost

node:
  name: Node-01
  token: auto-generated
```

### 7.3 Docker Compose

```yaml
services:
  panel:
    image: yourhost/panel:latest
    ports: ["3000:3000"]
    env_file: .env
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7

volumes:
  pgdata:
```

### 7.4 Agent install on nodes

On each node:
1. Install Docker.
2. Download agent binary.
3. Create systemd service.
4. Register node in admin panel.

### 7.5 Updates

```bash
yourhost update
```

Pulls latest images, restarts services.

---

## Phase 8: Security & Polish

### 8.1 Security

- HTTPS everywhere (Let's Encrypt via Caddy).
- Rate limit auth endpoints.
- Validate all file paths (no `..`, no escaping `/var/lib/yourhost/bots/{uuid}/`).
- Don't expose agent port to public. Use proxy.
- Run containers as non-root when possible.
- Hash passwords with bcrypt/Argon2.
- Verify OxaPay/Stripe webhook signatures.
- Log admin actions.

### 8.2 Abuse prevention

- Hard CPU/RAM/disk limits on every container.
- Rate limit console commands.
- Alert admins when a bot hammers CPU/RAM.
- Suspend crypto miners and malicious users instantly.

### 8.3 Backups

- Back up Postgres daily.
- Back up bot files to S3/B2 weekly or on demand.
- Test restoring. A backup that doesn't restore is useless.

### 8.4 Scaling

When you need more than one node:
1. Add nodes.
2. Improve node picker (region, load, ping).
3. Use Cloudflare in front of Panel.

Don't use Kubernetes. You don't need it.

---

## Build Order (do it in this order)

1. Auth (register/login/sessions).
2. DB schema (users, bots, nodes, runtimes, plans, billing).
3. Agent skeleton + Docker create/start/stop/delete.
4. Panel API for create/list/delete bots.
5. Simple dashboard (bot list + create form).
6. Console WebSocket (agent + xterm.js).
7. File manager.
8. Power controls.
9. Resource usage.
10. Env variables editor.
11. Billing + OxaPay/Stripe.
12. Admin panel.
13. One-command installer.
14. Polish.

Don't build 7-14 until 1-6 actually work.

---

## Common Pitfalls

### "I'll support every language and framework first."

No. Start with Python and Node. That's 95% of Discord bots. Add Java and Go later.

### "I'll let users run `pip install anything`."

They will install miners and scanners. Isolate everything in containers. Monitor abuse. Ban quickly.

### "I'll skip backups because it's annoying."

Your node will die. Backups save you.

### "I'll use Kubernetes."

You don't need it. Docker + agent is enough for a long time.

### "I'll make the UI complex."

Bot users are often kids or non-technical. Keep it simple. Big buttons. Clear status. No jargon.

### "I'll handle payments manually."

Use OxaPay/Stripe. Manual payments don't scale.

---

## Final Thoughts

A Discord bot host is not rocket science. It's a web app that puts user code into Docker containers and streams the logs back.

The hard parts are:
- Making install easy.
- Making the console reliable.
- Keeping abuse out.
- Making the UI feel good.

Start with Python and Node bots. Get paying customers. Then expand.

Keep the stack boring. Keep the UI clean. Keep the installer one command.

Good luck.

---

*Written for Raven Host. Focused on Discord bots, not game servers.*
