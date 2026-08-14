import { q, q1, genUuid, genIdentifier } from './db.js';
import { requireApiKey, hasPermission } from './api-keys.js';
import { agentRequest, agentRequestFor } from './agent-client.js';
import { renderStartup } from './admin-servers.js';
import { config } from './config.js';

// Pterodactyl-style Application API, authenticated with ptla_ keys.
export async function applicationRoutes(fastify) {
  // ── Servers ───────────────────────────────────────────────
  fastify.get('/api/application/servers', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'servers.read')) return reply.code(403).send({ error: 'Missing permission: servers.read' });
    const servers = await q(
      `SELECT s.*, u.username AS owner_username, n.name AS node_name, e.name AS egg_name
       FROM servers s JOIN users u ON u.id = s.user_id JOIN nodes n ON n.id = s.node_id JOIN eggs e ON e.id = s.egg_id
       ORDER BY s.created_at DESC`
    );
    return { servers };
  });

  fastify.get('/api/application/servers/:id', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'servers.read')) return reply.code(403).send({ error: 'Missing permission: servers.read' });
    const server = await q1(
      `SELECT s.*, u.username AS owner_username, n.name AS node_name, e.name AS egg_name
       FROM servers s JOIN users u ON u.id = s.user_id JOIN nodes n ON n.id = s.node_id JOIN eggs e ON e.id = s.egg_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    return { server };
  });

  fastify.post('/api/application/servers', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'servers.create')) return reply.code(403).send({ error: 'Missing permission: servers.create' });
    const { user_id, node_id, egg_id, name, description, memory_mb, cpu, disk_mb, swap_mb, io, databases, allocations, env, startup_command, docker_image } = req.body || {};
    if (!user_id || !node_id || !egg_id || !name) return reply.code(400).send({ error: 'user_id, node_id, egg_id, name required' });

    const user = await q1(`SELECT * FROM users WHERE id = $1`, [user_id]);
    const node = await q1(`SELECT * FROM nodes WHERE id = $1 AND enabled = true`, [node_id]);
    const egg = await q1(`SELECT * FROM eggs WHERE id = $1`, [egg_id]);
    if (!user || !node || !egg) return reply.code(400).send({ error: 'Invalid user, node or egg' });

    const d = config.defaults;
    const mem = memory_mb || d.memory_mb;
    const cpuPct = cpu || d.cpu;
    const disk = disk_mb || d.disk_mb;
    const swap = swap_mb ?? d.swap_mb;
    const ioVal = io || d.io;
    const dbCount = databases ?? d.databases;
    const allocCount = allocations ?? d.allocations;

    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1`, [egg.id]);
    const mergedEnv = {};
    for (const v of variables) mergedEnv[v.env_variable] = v.default_value;
    for (const [k, val] of Object.entries(env || {})) mergedEnv[k] = val;

    const finalStartup = startup_command || renderStartup(egg.startup_command, mergedEnv);
    const finalImage = docker_image || egg.docker_image;
    const uuid = genUuid();
    const identifier = genIdentifier();

    const server = await q1(
      `INSERT INTO servers (uuid, identifier, name, description, user_id, node_id, nest_id, egg_id,
        status, memory_mb, cpu, disk_mb, swap_mb, io, databases, allocations, startup_command, docker_image, env)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'installing',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [uuid, identifier, name, description || '', user.id, node.id, egg.nest_id, egg.id,
       mem, cpuPct, disk, swap, ioVal, dbCount, allocCount, finalStartup, finalImage, JSON.stringify(mergedEnv)]
    );

    agentRequest('/servers', 'POST', {
      uuid, identifier, image: finalImage, startup_command: finalStartup,
      install_command: egg.skip_install ? null : egg.default_install_command,
      memory_mb: mem, disk_mb: disk, cpu: cpuPct, swap_mb: swap, io: ioVal, env: mergedEnv, mounts: [],
      mount_target: egg.mount_target || '/home/container',
    }, { node }).then(async (res) => {
      await q(`UPDATE servers SET container_id = $1, status = 'offline' WHERE id = $2`, [res.container_id, server.id]);
    }).catch(async (e) => {
      console.error('[api] agent create failed:', e.message);
      await q(`UPDATE servers SET status = 'install_failed' WHERE id = $1`, [server.id]);
    });

    return reply.code(201).send({ server });
  });

  fastify.delete('/api/application/servers/:id', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'servers.delete')) return reply.code(403).send({ error: 'Missing permission: servers.delete' });
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try { await agentRequestFor(server.uuid, `/servers/${server.uuid}`, 'DELETE'); } catch {}
    await q(`UPDATE allocations SET server_id = NULL WHERE server_id = $1`, [server.id]);
    await q(`DELETE FROM servers WHERE id = $1`, [server.id]);
    return { ok: true };
  });

  fastify.post('/api/application/servers/:id/power', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'servers.power')) return reply.code(403).send({ error: 'Missing permission: servers.power' });
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const { action } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    const res = await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action });
    const status = action === 'start' ? 'running' : (action === 'stop' || action === 'kill') ? 'offline' : server.status;
    await q(`UPDATE servers SET status = $1 WHERE id = $2`, [status, server.id]);
    return { ok: true, status: res.status || status };
  });

  // ── Users ─────────────────────────────────────────────────
  fastify.get('/api/application/users', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'users.read')) return reply.code(403).send({ error: 'Missing permission: users.read' });
    const users = await q(`SELECT id, uuid, username, email, root_admin, suspended, created_at FROM users ORDER BY created_at DESC`);
    return { users };
  });

  fastify.post('/api/application/users', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'users.create')) return reply.code(403).send({ error: 'Missing permission: users.create' });
    const { username, email, password, root_admin } = req.body || {};
    const { registerUser } = await import('./auth.js');
    try {
      const user = await registerUser(username, email, password);
      if (root_admin) await q(`UPDATE users SET root_admin = true WHERE id = $1`, [user.id]);
      return reply.code(201).send({ user: { ...user, root_admin: !!root_admin } });
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // ── Nodes / locations / nests / eggs ──────────────────────
  fastify.get('/api/application/nodes', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'nodes.read')) return reply.code(403).send({ error: 'Missing permission: nodes.read' });
    const nodes = await q(`SELECT id, uuid, name, fqdn, port, scheme, memory_mb, disk_mb, cpu_cores, enabled, location_id FROM nodes ORDER BY name`);
    return { nodes };
  });

  fastify.get('/api/application/locations', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'locations.read')) return reply.code(403).send({ error: 'Missing permission: locations.read' });
    const locations = await q(`SELECT * FROM locations ORDER BY short`);
    return { locations };
  });

  fastify.get('/api/application/nests', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'nests.read')) return reply.code(403).send({ error: 'Missing permission: nests.read' });
    const nests = await q(`SELECT * FROM nests ORDER BY name`);
    return { nests };
  });

  fastify.get('/api/application/nests/:id/eggs', { preHandler: requireApiKey }, async (req, reply) => {
    if (!hasPermission(req.apiKey, 'nests.read')) return reply.code(403).send({ error: 'Missing permission: nests.read' });
    const eggs = await q(`SELECT * FROM eggs WHERE nest_id = $1 ORDER BY name`, [req.params.id]);
    return { eggs };
  });
}
