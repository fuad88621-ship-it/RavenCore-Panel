import path from 'node:path';
import { Readable } from 'node:stream';
import { q, q1 } from './db.js';
import { requireAuth } from './auth.js';
import { agentRequest, agentRequestFor, consoleToken } from './agent-client.js';
import { config } from './config.js';
import { getServerMetrics } from './metrics.js';
import { renderStartup, validateRules } from './admin-servers.js';
import { createDatabase, deleteDatabase, rotateDatabasePassword } from './admin-databases.js';

async function logActivity(serverId, userId, action, metadata = {}) {
  try {
    await q(
      `INSERT INTO activity_logs (server_id, user_id, action, metadata) VALUES ($1,$2,$3,$4)`,
      [serverId, userId, action, JSON.stringify(metadata)]
    );
  } catch (e) {
    console.error('[activity] log failed:', e.message);
  }
}

async function getServerForUser(req, reply) {
  const server = await q1(
    `SELECT s.*, e.name AS egg_name, e.startup_command AS egg_startup, e.docker_image AS egg_image,
            n.name AS node_name, n.fqdn AS node_fqdn, n.port AS node_port, n.scheme AS node_scheme, n.behind_proxy AS node_behind_proxy,
            n.id AS node_id, n.daemon_token AS node_daemon_token,
            nest.name AS nest_name,
            a.ip AS allocation_ip, a.port AS allocation_port
     FROM servers s
     JOIN eggs e ON e.id = s.egg_id
     JOIN nodes n ON n.id = s.node_id
     JOIN nests nest ON nest.id = s.nest_id
     LEFT JOIN allocations a ON a.server_id = s.id
     WHERE s.id = $1
     ORDER BY a.port NULLS LAST
     LIMIT 1`,
    [req.params.id]
  );
  if (!server) {
    reply.code(404).send({ error: 'Server not found' });
    return null;
  }
  if (req.user.root_admin || server.user_id === req.user.id) return server;
  // Subuser access — attach their permissions so routes can enforce them.
  const su = await q1(
    `SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2`,
    [server.id, req.user.id]
  );
  if (!su) {
    reply.code(403).send({ error: 'Not your server' });
    return null;
  }
  server.subuser_permissions = su.permissions || [];
  return server;
}

// Permission check for subusers. Owners/admins always pass.
function can(server, perm) {
  if (!server.subuser_permissions) return true;
  return server.subuser_permissions.includes(perm);
}

export async function clientRoutes(fastify) {
  // List my servers
  fastify.get('/api/client/servers', { preHandler: requireAuth }, async (req) => {
    const servers = await q(
      `SELECT s.id, s.uuid, s.identifier, s.name, s.description, s.status, s.memory_mb, s.cpu, s.disk_mb,
              e.name AS egg_name, n.name AS node_name
       FROM servers s
       JOIN eggs e ON e.id = s.egg_id
       JOIN nodes n ON n.id = s.node_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    return { servers };
  });

  // List servers shared with me (sub-user) or, for admins, all other users' servers
  fastify.get('/api/client/servers/shared', { preHandler: requireAuth }, async (req) => {
    if (req.user.root_admin) {
      const servers = await q(
        `SELECT s.id, s.uuid, s.identifier, s.name, s.description, s.status, s.memory_mb, s.cpu, s.disk_mb,
                e.name AS egg_name, n.name AS node_name, u.username AS owner_username
         FROM servers s
         JOIN eggs e ON e.id = s.egg_id
         JOIN nodes n ON n.id = s.node_id
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id != $1
         ORDER BY s.created_at DESC`,
        [req.user.id]
      );
      return { servers };
    }
    const servers = await q(
      `SELECT s.id, s.uuid, s.identifier, s.name, s.description, s.status, s.memory_mb, s.cpu, s.disk_mb,
              e.name AS egg_name, n.name AS node_name, u.username AS owner_username
       FROM servers s
       JOIN eggs e ON e.id = s.egg_id
       JOIN nodes n ON n.id = s.node_id
       JOIN server_subusers su ON su.server_id = s.id
       JOIN users u ON u.id = s.user_id
       WHERE su.user_id = $1
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    return { servers };
  });

  // Server detail
  fastify.get('/api/client/servers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1 ORDER BY created_at`, [server.egg_id]);
    const mounts = await q(
      `SELECT m.* FROM mounts m JOIN mount_servers ms ON ms.mount_id = m.id WHERE ms.server_id = $1`,
      [server.id]
    );
    // Let the frontend hide tabs the current user can't use.
    const isOwner = req.user.root_admin || server.user_id === req.user.id;
    const perms = isOwner ? null : (server.subuser_permissions || []);
    return { server, variables, mounts, perms };
  });

  // Activity feed
  fastify.get('/api/client/servers/:id/activity', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const logs = await q(
      `SELECT al.*, u.username FROM activity_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.server_id = $1 ORDER BY al.created_at DESC LIMIT 100`,
      [server.id]
    );
    return { logs };
  });

  // Power
  fastify.post('/api/client/servers/:id/power', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'console')) return reply.code(403).send({ error: 'Missing permission: console' });
    const { action } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    if (server.status === 'suspended') return reply.code(403).send({ error: 'Server suspended' });
    let res;
    try {
      res = await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action });
    } catch (e) {
      // Agent errors (e.g. container already stopped) shouldn't be a 500 —
      // return a friendly 400 so the frontend can toast it instead of
      // showing a full-page error.
      return reply.code(400).send({ error: e.message.replace(/^Error: /, '') });
    }
    const status = action === 'start' ? 'running' : (action === 'stop' || action === 'kill') ? 'offline' : server.status;
    await q(`UPDATE servers SET status = $1 WHERE id = $2`, [status, server.id]);
    await logActivity(server.id, req.user.id, `server.${action}`);
    return { ok: true, status: res.status || status };
  });

  // Send command to stdin
  fastify.post('/api/client/servers/:id/command', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'console')) return reply.code(403).send({ error: 'Missing permission: console' });
    const { command } = req.body || {};
    if (!command) return reply.code(400).send({ error: 'command required' });
    await agentRequestFor(server.uuid, `/servers/${server.uuid}/command`, 'POST', { command });
    return { ok: true };
  });

  // Console credentials
  fastify.get('/api/client/servers/:id/console', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'console')) return reply.code(403).send({ error: 'Missing permission: console' });
    // Node agents (installed via install.sh) verify console JWTs with their
    // own CONSOLE_SECRET = daemon_token. Local nodes share the panel's
    // console_secret. Sign with the right secret per node so consoles work on
    // every node, not just the local one.
    const isLocal = server.node_name === config.node.name || server.node_fqdn === config.node.fqdn;
    const secret = isLocal ? config.security.console_secret : server.node_daemon_token;
    const token = consoleToken(server, secret);
    // Behind a proxy (Caddy/nginx) → wss://fqdn (no port). Direct agent → ws://fqdn:port.
    const wsScheme = server.node_scheme === 'https' ? 'wss' : 'ws';
    const host = server.node_behind_proxy
      ? server.node_fqdn
      : `${server.node_fqdn}:${server.node_port || 8080}`;
    return {
      socket: `${wsScheme}://${host}/servers/${server.uuid}/ws?token=${token}`,
      token,
    };
  });

  // Files
  fastify.get('/api/client/servers/:id/files', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    const path = req.query.path || '/';
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files?path=${encodeURIComponent(path)}`);
  });

  fastify.post('/api/client/servers/:id/files/read', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files/read`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/write', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    const res = await agentRequestFor(server.uuid, `/servers/${server.uuid}/files/write`, 'POST', req.body);
    await logActivity(server.id, req.user.id, 'file.write', { path: req.body.path });
    return res;
  });

  fastify.post('/api/client/servers/:id/files/delete', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files/delete`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/rename', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files/rename`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/archive', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files/archive`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/extract', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files/extract`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/mkdir', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/files/mkdir`, 'POST', req.body);
  });

  fastify.get('/api/client/servers/:id/files/download', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    const agentRes = await agentRequestFor(server.uuid, `/servers/${server.uuid}/files/download?path=${encodeURIComponent(req.query.path)}`, 'GET', null, { raw: true });
    reply.header('Content-Disposition', agentRes.headers['content-disposition'] || `attachment; filename="${path.basename(req.query.path)}"`);
    reply.type(agentRes.headers['content-type'] || 'application/octet-stream');
    // fetch() gives a WHATWG ReadableStream — Fastify can't stream that
    // directly (it would send an empty body). Convert to a Node stream.
    return Readable.fromWeb(agentRes.body);
  });

  // Resources
  fastify.get('/api/client/servers/:id/resources', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'network')) return reply.code(403).send({ error: 'Missing permission: network' });
    return agentRequestFor(server.uuid, `/servers/${server.uuid}/resources`);
  });

  // Resource history (live graphs)
  fastify.get('/api/client/servers/:id/metrics', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'network')) return reply.code(403).send({ error: 'Missing permission: network' });
    if (!server) return;
    const hours = parseInt(req.query.hours) || 24;
    return { metrics: await getServerMetrics(server.id, hours) };
  });

  // Alerts for my servers
  fastify.get('/api/client/alerts', { preHandler: requireAuth }, async (req) => {
    const alerts = await q(
      `SELECT a.id, a.type, a.message, a.severity, a.read, a.created_at, s.name AS server_name
       FROM alerts a JOIN servers s ON s.id = a.server_id
       WHERE s.user_id = $1
       ORDER BY a.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const unread = await q1(
      `SELECT COUNT(*)::int AS n FROM alerts a JOIN servers s ON s.id = a.server_id
       WHERE s.user_id = $1 AND a.read = false`,
      [req.user.id]
    );
    return { alerts, unread: unread?.n || 0 };
  });

  // Mark all my alerts as read
  fastify.post('/api/client/alerts/read', { preHandler: requireAuth }, async (req) => {
    await q(
      `UPDATE alerts SET read = true WHERE id IN (
         SELECT a.id FROM alerts a JOIN servers s ON s.id = a.server_id
         WHERE s.user_id = $1 AND a.read = false
       )`,
      [req.user.id]
    );
    return { ok: true };
  });

  // Install log
  fastify.get('/api/client/servers/:id/install-log', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'console')) return reply.code(403).send({ error: 'Missing permission: console' });
    const res = await agentRequestFor(server.uuid, `/servers/${server.uuid}/install-log`, 'GET');
    return { log: (res && res.log) || '' };
  });

  // Plugins (Modrinth marketplace)
  const pluginVersionCache = new Map(); // project_id -> { versions, ts }
  async function pluginCompatible(projectId, serverVersion) {
    if (!serverVersion || serverVersion === 'latest') return { compatible: true, version: null };
    const cached = pluginVersionCache.get(projectId);
    if (cached && Date.now() - cached.ts < 600000) return cached;
    try {
      const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`);
      if (!res.ok) return { compatible: true, version: null };
      const versions = await res.json();
      const match = (versions || []).find((v) => (v.game_versions || []).includes(serverVersion));
      const out = { compatible: !!match, version: match ? match.version_number : null };
      pluginVersionCache.set(projectId, { ...out, ts: Date.now() });
      return out;
    } catch {
      return { compatible: true, version: null };
    }
  }

  fastify.get('/api/client/servers/:id/plugins/search', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    const qq = String(req.query.q || '').trim();
    // Empty query -> popular plugins (sorted by downloads)
    const facets = [['project_type:plugin']];
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(qq)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=12&index=${qq ? 'relevance' : 'downloads'}`;
    const res = await fetch(url);
    if (!res.ok) return reply.code(502).send({ error: 'Plugin search failed' });
    const data = await res.json();
    // Server's Minecraft version (from the egg's VERSION variable)
    let serverVersion = null;
    try { serverVersion = (JSON.parse(server.env || '{}') || {}).VERSION || null; } catch {}
    const hits = await Promise.all((data.hits || []).map(async (h) => {
      const compat = await pluginCompatible(h.project_id, serverVersion);
      return {
        project_id: h.project_id, title: h.title, description: h.description,
        downloads: h.downloads, icon_url: h.icon_url, author: h.author, slug: h.slug,
        compatible: compat.compatible, compatible_version: compat.version,
      };
    }));
    return { hits, server_version: serverVersion };
  });

  fastify.get('/api/client/servers/:id/plugins', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return await agentRequestFor(server.uuid, `/servers/${server.uuid}/plugins`, 'GET');
  });

  fastify.post('/api/client/servers/:id/plugins/install', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    const { project_id } = req.body || {};
    if (!project_id) return reply.code(400).send({ error: 'project_id is required' });
    // Fetch the project's latest version and grab the first jar file
    const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(project_id)}/version`);
    if (!res.ok) return reply.code(502).send({ error: 'Failed to fetch plugin versions' });
    const versions = await res.json();
    const version = (versions || []).find((v) => v.files && v.files.length > 0);
    if (!version) return reply.code(404).send({ error: 'No downloadable version found' });
    const file = version.files[0];
    const result = await agentRequestFor(server.uuid, `/servers/${server.uuid}/plugins/install`, 'POST', {
      url: file.url, filename: file.filename,
    });
    return { ok: true, filename: result.filename, size: result.size, version: version.version_number };
  });

  fastify.delete('/api/client/servers/:id/plugins/:filename', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'files')) return reply.code(403).send({ error: 'Missing permission: files' });
    return await agentRequestFor(server.uuid, `/servers/${server.uuid}/plugins/${encodeURIComponent(req.params.filename)}`, 'DELETE');
  });

  // Databases
  fastify.get('/api/client/servers/:id/databases', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'databases')) return reply.code(403).send({ error: 'Missing permission: databases' });
    const databases = await q(`SELECT * FROM server_databases WHERE server_id = $1 ORDER BY created_at DESC`, [server.id]);
    return { databases };
  });

  fastify.post('/api/client/servers/:id/databases', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'databases')) return reply.code(403).send({ error: 'Missing permission: databases' });
    const count = await q1(`SELECT count(*)::int AS c FROM server_databases WHERE server_id = $1`, [server.id]);
    if (count.c >= server.databases) return reply.code(400).send({ error: `Database limit reached (${server.databases})` });
    const db = await createDatabase(server, req.body?.name);
    await logActivity(server.id, req.user.id, 'database.create', { name: db.database_name });
    return reply.code(201).send({ database: db });
  });

  fastify.delete('/api/client/databases/:id', { preHandler: requireAuth }, async (req, reply) => {
    const record = await q1(
      `SELECT d.*, s.user_id AS owner_id FROM server_databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1`,
      [req.params.id]
    );
    if (!record) return reply.code(404).send({ error: 'Database not found' });
    if (!req.user.root_admin && record.owner_id !== req.user.id) {
      const su = await q1(`SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2`, [record.server_id, req.user.id]);
      if (!su || !(su.permissions || []).includes('databases')) return reply.code(403).send({ error: 'Missing permission: databases' });
    }
    return deleteDatabase(record);
  });

  fastify.post('/api/client/databases/:id/rotate', { preHandler: requireAuth }, async (req, reply) => {
    const record = await q1(
      `SELECT d.*, s.user_id AS owner_id FROM server_databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1`,
      [req.params.id]
    );
    if (!record) return reply.code(404).send({ error: 'Database not found' });
    if (!req.user.root_admin && record.owner_id !== req.user.id) {
      const su = await q1(`SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2`, [record.server_id, req.user.id]);
      if (!su || !(su.permissions || []).includes('databases')) return reply.code(403).send({ error: 'Missing permission: databases' });
    }
    const updated = await rotateDatabasePassword(record);
    return { database: updated };
  });

  // Startup variables
  fastify.get('/api/client/servers/:id/startup', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'startup')) return reply.code(403).send({ error: 'Missing permission: startup' });
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1 ORDER BY created_at`, [server.egg_id]);
    return { variables, env: server.env, startup_command: server.startup_command, docker_image: server.docker_image };
  });

  fastify.patch('/api/client/servers/:id/startup', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'startup')) return reply.code(403).send({ error: 'Missing permission: startup' });
    const { env } = req.body || {};
    if (!env) return reply.code(400).send({ error: 'env required' });
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1`, [server.egg_id]);
    // Validate the submitted values against the egg variable rules before saving.
    for (const v of variables) {
      if (env[v.env_variable] === undefined) continue;
      const err = validateRules(v.rules, env[v.env_variable]);
      if (err) return reply.code(400).send({ error: `${v.name}: ${err}` });
    }
    const merged = { ...server.env, ...env };
    // Only allow editing user_editable variables
    for (const v of variables) {
      if (!v.user_editable && env[v.env_variable] !== undefined) {
        delete merged[v.env_variable];
      }
    }
    const newStartup = renderStartup(server.egg_startup, merged);
    await q(`UPDATE servers SET env = $1, startup_command = $2 WHERE id = $3`, [JSON.stringify(merged), newStartup, server.id]);
    await agentRequestFor(server.uuid, `/servers/${server.uuid}/spec`, 'PATCH', { env: merged, startup_command: newStartup });
    return { ok: true };
  });

  // Settings (rename, reinstall)
  fastify.patch('/api/client/servers/:id/settings', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'settings')) return reply.code(403).send({ error: 'Missing permission: settings' });
    const { name, description } = req.body || {};
    const updated = await q1(
      `UPDATE servers SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *`,
      [name, description, server.id]
    );
    return { server: updated };
  });

  fastify.post('/api/client/servers/:id/reinstall', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'settings')) return reply.code(403).send({ error: 'Missing permission: settings' });
    await q(`UPDATE servers SET status = 'installing' WHERE id = $1`, [server.id]);
    agentRequestFor(server.uuid, `/servers/${server.uuid}/reinstall`, 'POST', {
      image: server.egg_image,
      install_command: null,
    }).then(async () => {
      await q(`UPDATE servers SET status = 'offline' WHERE id = $1`, [server.id]);
    }).catch(async (e) => {
      console.error('[client] reinstall failed:', e.message);
      await q(`UPDATE servers SET status = 'install_failed' WHERE id = $1`, [server.id]);
    });
    return { ok: true };
  });

  // Delete own server — OWNER/ADMIN ONLY. Subusers must never be able to
  // delete a server they were merely granted access to, even with the
  // 'settings' permission (that permission only covers rename/reinstall).
  fastify.delete('/api/client/servers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!req.user.root_admin && server.user_id !== req.user.id) {
      return reply.code(403).send({ error: 'Only the owner can delete this server' });
    }
    try {
      await agentRequestFor(server.uuid, `/servers/${server.uuid}`, 'DELETE');
    } catch (e) {
      console.error('[client] agent delete failed:', e.message);
    }
    // Drop the server's MariaDB databases (rows cascade, MySQL dbs don't).
    const dbs = await q(`SELECT * FROM server_databases WHERE server_id = $1`, [server.id]);
    for (const db of dbs) {
      try { await deleteDatabase(db); } catch (e) { console.error('[client] db cleanup failed:', e.message); }
    }
    await q(`UPDATE allocations SET server_id = NULL WHERE server_id = $1`, [server.id]);
    await q(`DELETE FROM servers WHERE id = $1`, [server.id]);
    return { ok: true };
  });
}
