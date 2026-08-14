import { q, q1 } from './db.js';
import { requireAuth } from './auth.js';
import { agentRequest, consoleToken } from './agent-client.js';
import { renderStartup } from './admin-servers.js';
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
            n.name AS node_name, n.fqdn AS node_fqdn, nest.name AS nest_name,
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
  if (!req.user.root_admin && server.user_id !== req.user.id) {
    reply.code(403).send({ error: 'Not your server' });
    return null;
  }
  return server;
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

  // Server detail
  fastify.get('/api/client/servers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1 ORDER BY created_at`, [server.egg_id]);
    const mounts = await q(
      `SELECT m.* FROM mounts m JOIN mount_servers ms ON ms.mount_id = m.id WHERE ms.server_id = $1`,
      [server.id]
    );
    return { server, variables, mounts };
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
    const { action } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    if (server.status === 'suspended') return reply.code(403).send({ error: 'Server suspended' });
    const res = await agentRequest(`/servers/${server.uuid}/power`, 'POST', { action });
    const status = action === 'start' ? 'running' : (action === 'stop' || action === 'kill') ? 'offline' : server.status;
    await q(`UPDATE servers SET status = $1 WHERE id = $2`, [status, server.id]);
    await logActivity(server.id, req.user.id, `server.${action}`);
    return { ok: true, status: res.status || status };
  });

  // Send command to stdin
  fastify.post('/api/client/servers/:id/command', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const { command } = req.body || {};
    if (!command) return reply.code(400).send({ error: 'command required' });
    await agentRequest(`/servers/${server.uuid}/command`, 'POST', { command });
    return { ok: true };
  });

  // Console credentials
  fastify.get('/api/client/servers/:id/console', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const token = consoleToken(server);
    return {
      socket: `wss://${server.node_fqdn}/servers/${server.uuid}/ws?token=${token}`,
      token,
    };
  });

  // Files
  fastify.get('/api/client/servers/:id/files', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const path = req.query.path || '/';
    return agentRequest(`/servers/${server.uuid}/files?path=${encodeURIComponent(path)}`);
  });

  fastify.post('/api/client/servers/:id/files/read', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    return agentRequest(`/servers/${server.uuid}/files/read`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/write', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const res = await agentRequest(`/servers/${server.uuid}/files/write`, 'POST', req.body);
    await logActivity(server.id, req.user.id, 'file.write', { path: req.body.path });
    return res;
  });

  fastify.post('/api/client/servers/:id/files/delete', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    return agentRequest(`/servers/${server.uuid}/files/delete`, 'POST', req.body);
  });

  fastify.post('/api/client/servers/:id/files/rename', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    return agentRequest(`/servers/${server.uuid}/files/rename`, 'POST', req.body);
  });

  // Resources
  fastify.get('/api/client/servers/:id/resources', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    return agentRequest(`/servers/${server.uuid}/resources`);
  });

  // Install log
  fastify.get('/api/client/servers/:id/install-log', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const log = await agentRequest(`/servers/${server.uuid}/install-log`, 'GET');
    return { log };
  });

  // Databases
  fastify.get('/api/client/servers/:id/databases', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const databases = await q(`SELECT * FROM server_databases WHERE server_id = $1 ORDER BY created_at DESC`, [server.id]);
    return { databases };
  });

  fastify.post('/api/client/servers/:id/databases', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const count = await q1(`SELECT count(*)::int AS c FROM server_databases WHERE server_id = $1`, [server.id]);
    if (count.c >= server.databases) return reply.code(400).send({ error: `Database limit reached (${server.databases})` });
    const db = await createDatabase(server, req.body?.name);
    await logActivity(server.id, req.user.id, 'database.create', { name: db.database_name });
    return reply.code(201).send({ database: db });
  });

  fastify.delete('/api/client/databases/:id', { preHandler: requireAuth }, async (req, reply) => {
    const record = await q1(
      `SELECT d.* FROM server_databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!record) return reply.code(404).send({ error: 'Database not found' });
    return deleteDatabase(record);
  });

  fastify.post('/api/client/databases/:id/rotate', { preHandler: requireAuth }, async (req, reply) => {
    const record = await q1(
      `SELECT d.* FROM server_databases d JOIN servers s ON s.id = d.server_id WHERE d.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!record) return reply.code(404).send({ error: 'Database not found' });
    const updated = await rotateDatabasePassword(record);
    return { database: updated };
  });

  // Startup variables
  fastify.get('/api/client/servers/:id/startup', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1 ORDER BY created_at`, [server.egg_id]);
    return { variables, env: server.env, startup_command: server.startup_command, docker_image: server.docker_image };
  });

  fastify.patch('/api/client/servers/:id/startup', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const { env } = req.body || {};
    if (!env) return reply.code(400).send({ error: 'env required' });
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1`, [server.egg_id]);
    const merged = { ...server.env, ...env };
    // Only allow editing user_editable variables
    for (const v of variables) {
      if (!v.user_editable && env[v.env_variable] !== undefined) {
        delete merged[v.env_variable];
      }
    }
    const newStartup = renderStartup(server.egg_startup, merged);
    await q(`UPDATE servers SET env = $1, startup_command = $2 WHERE id = $3`, [JSON.stringify(merged), newStartup, server.id]);
    await agentRequest(`/servers/${server.uuid}/spec`, 'PATCH', { env: merged, startup_command: newStartup });
    return { ok: true };
  });

  // Settings (rename, reinstall)
  fastify.patch('/api/client/servers/:id/settings', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
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
    await q(`UPDATE servers SET status = 'installing' WHERE id = $1`, [server.id]);
    agentRequest(`/servers/${server.uuid}/reinstall`, 'POST', {
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

  // Delete own server
  fastify.delete('/api/client/servers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    try {
      await agentRequest(`/servers/${server.uuid}`, 'DELETE');
    } catch (e) {
      console.error('[client] agent delete failed:', e.message);
    }
    await q(`UPDATE allocations SET server_id = NULL WHERE server_id = $1`, [server.id]);
    await q(`DELETE FROM servers WHERE id = $1`, [server.id]);
    return { ok: true };
  });
}
