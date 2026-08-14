import crypto from 'node:crypto';
import path from 'node:path';
import { q, q1, genUuid } from './db.js';
import { requireAdmin } from './auth.js';
import { createApiKey, listApiKeys, deleteApiKey } from './api-keys.js';
import { agentRequest } from './agent-client.js';
import { getNodeHealth } from './metrics.js';
import { authApiKey, hasPermission } from './api-keys.js';

export async function adminRoutes(fastify) {
  // ── Overview ──────────────────────────────────────────────
  fastify.get('/api/admin/overview', { preHandler: requireAdmin }, async () => {
    const [users, servers, running, nodes, locations, eggs] = await Promise.all([
      q1(`SELECT count(*)::int AS c FROM users`),
      q1(`SELECT count(*)::int AS c FROM servers`),
      q1(`SELECT count(*)::int AS c FROM servers WHERE status = 'running'`),
      q1(`SELECT count(*)::int AS c FROM nodes WHERE enabled = true`),
      q1(`SELECT count(*)::int AS c FROM locations`),
      q1(`SELECT count(*)::int AS c FROM eggs`),
    ]);
    const nodeStats = await q(
      `SELECT n.name, n.memory_mb, n.disk_mb, n.cpu_cores,
              COALESCE(SUM(s.memory_mb), 0)::int AS used_memory,
              COALESCE(SUM(s.disk_mb), 0)::int AS used_disk,
              COALESCE(SUM(s.cpu), 0)::int AS used_cpu,
              count(s.id)::int AS server_count
       FROM nodes n LEFT JOIN servers s ON s.node_id = n.id
       GROUP BY n.id ORDER BY n.name`
    );
    return {
      users: users.c, servers: servers.c, running: running.c,
      nodes: nodes.c, locations: locations.c, eggs: eggs.c,
      nodeStats,
    };
  });

  // ── Settings ──────────────────────────────────────────────
  fastify.get('/api/admin/settings', { preHandler: requireAdmin }, async () => {
    const rows = await q(`SELECT key, value FROM settings ORDER BY key`);
    return { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });

  fastify.patch('/api/admin/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const updates = req.body || {};
    for (const [k, v] of Object.entries(updates)) {
      await q(`INSERT INTO settings (key, value) VALUES ($1, $2)
               ON CONFLICT (key) DO UPDATE SET value = $2`, [k, String(v)]);
    }
    return { ok: true };
  });

  // ── Application API keys ──────────────────────────────────
  fastify.get('/api/admin/api-keys', { preHandler: requireAdmin }, async (req) => {
    return { keys: await listApiKeys(req.user.id) };
  });

  fastify.post('/api/admin/api-keys', { preHandler: requireAdmin }, async (req, reply) => {
    const { description, permissions } = req.body || {};
    const { key, prefix } = await createApiKey(req.user.id, description, permissions || ['*']);
    return reply.code(201).send({ key, prefix, note: 'Store this key now — it is shown only once.' });
  });

  fastify.delete('/api/admin/api-keys/:id', { preHandler: requireAdmin }, async (req) => {
    return deleteApiKey(req.user.id, req.params.id);
  });

  // ── Locations ──────────────────────────────────────────────
  fastify.get('/api/admin/locations', { preHandler: requireAdmin }, async () => {
    const locations = await q(
      `SELECT l.*, (SELECT count(*)::int FROM nodes n WHERE n.location_id = l.id) AS node_count
       FROM locations l ORDER BY l.created_at DESC`
    );
    return { locations };
  });

  fastify.post('/api/admin/locations', { preHandler: requireAdmin }, async (req, reply) => {
    const { short, long } = req.body || {};
    if (!short) return reply.code(400).send({ error: 'short is required' });
    try {
      const loc = await q1(`INSERT INTO locations (short, long) VALUES ($1, $2) RETURNING *`, [short, long || '']);
      return reply.code(201).send({ location: loc });
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Location short already exists' });
      throw e;
    }
  });

  fastify.patch('/api/admin/locations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { short, long } = req.body || {};
    const loc = await q1(`UPDATE locations SET short = COALESCE($1, short), long = COALESCE($2, long) WHERE id = $3 RETURNING *`, [short, long, req.params.id]);
    if (!loc) return reply.code(404).send({ error: 'Location not found' });
    return { location: loc };
  });

  fastify.delete('/api/admin/locations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const nodes = await q1(`SELECT count(*)::int AS c FROM nodes WHERE location_id = $1`, [req.params.id]);
    if (nodes.c > 0) return reply.code(400).send({ error: 'Location has nodes — move them first' });
    await q(`DELETE FROM locations WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Nodes ──────────────────────────────────────────────────
  fastify.get('/api/admin/nodes', { preHandler: requireAdmin }, async () => {
    const nodes = await q(
      `SELECT n.*, l.short AS location_short,
              (SELECT count(*)::int FROM servers s WHERE s.node_id = n.id) AS server_count,
              COALESCE((SELECT SUM(s.memory_mb)::int FROM servers s WHERE s.node_id = n.id), 0) AS used_memory,
              COALESCE((SELECT SUM(s.disk_mb)::int FROM servers s WHERE s.node_id = n.id), 0) AS used_disk
       FROM nodes n LEFT JOIN locations l ON l.id = n.location_id
       ORDER BY n.created_at DESC`
    );
    return { nodes };
  });

  // Live health for every node (CPU/RAM/disk/load/uptime/containers)
  fastify.get('/api/admin/nodes/health', { preHandler: requireAdmin }, async () => {
    return { nodes: await getNodeHealth() };
  });

  // All alerts (admin view)
  fastify.get('/api/admin/alerts', { preHandler: requireAdmin }, async () => {
    const alerts = await q(
      `SELECT a.*, s.name AS server_name, n.name AS node_name
       FROM alerts a
       LEFT JOIN servers s ON s.id = a.server_id
       LEFT JOIN nodes n ON n.id = a.node_id
       ORDER BY a.created_at DESC LIMIT 100`
    );
    return { alerts };
  });

  // Node self-registration — called by the one-command installer on a new
  // VPS. Authenticated with an application API key that has `node:create`.
  fastify.post('/api/admin/nodes/register', async (req, reply) => {
    const key = await authApiKey(req);
    if (!key) return reply.code(401).send({ error: 'Invalid API key' });
    if (!hasPermission(key, 'node:create') && !hasPermission(key, 'nodes.create')) {
      return reply.code(403).send({ error: 'API key lacks node:create permission' });
    }
    const { name, fqdn, port, scheme, memory_mb, disk_mb, cpu_cores, file_directory, sftp_port } = req.body || {};
    if (!name || !fqdn) {
      return reply.code(400).send({ error: 'name and fqdn are required' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const loc = await q1(`SELECT id FROM locations ORDER BY created_at LIMIT 1`);
    // Idempotent: if a node with this name already exists (e.g. the installer
    // was re-run), update it and keep the existing daemon token so the agent
    // on the VPS stays valid.
    const existing = await q1(`SELECT id, daemon_token FROM nodes WHERE name = $1`, [name]);
    if (existing) {
      const node = await q1(
        `UPDATE nodes SET fqdn = $1, port = $2, scheme = $3, memory_mb = $4, disk_mb = $5,
         cpu_cores = $6, file_directory = $7, sftp_port = $8, enabled = true, updated_at = now()
         WHERE id = $9 RETURNING id, uuid, name, fqdn, port, scheme`,
        [fqdn, port || 8080, scheme || 'http', memory_mb || 0, disk_mb || 0, cpu_cores || 0,
         file_directory || '/var/lib/raven/bots', sftp_port || 2022, existing.id]
      );
      return reply.code(200).send({ node, daemon_token: existing.daemon_token, updated: true });
    }
    try {
      const node = await q1(
        `INSERT INTO nodes (uuid, name, description, location_id, fqdn, port, scheme, visibility, behind_proxy, file_directory, sftp_port, memory_mb, disk_mb, cpu_cores, daemon_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, uuid, name, fqdn, port, scheme`,
        [genUuid(), name, 'Registered via installer', loc?.id || null, fqdn, port || 8080, scheme || 'http',
         'public', false, file_directory || '/var/lib/raven/bots', sftp_port || 2022,
         memory_mb || 0, disk_mb || 0, cpu_cores || 0, token]
      );
      return reply.code(201).send({ node, daemon_token: token });
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Node name already exists' });
      throw e;
    }
  });

  fastify.post('/api/admin/nodes', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, location_id, fqdn, port, scheme, visibility, behind_proxy, file_directory, sftp_port, memory_mb, disk_mb, cpu_cores, memory_overallocate, disk_overallocate, cpu_overallocate, daemon_token } = req.body || {};
    if (!name || !fqdn) {
      return reply.code(400).send({ error: 'name and fqdn are required' });
    }
    const token = daemon_token || crypto.randomBytes(32).toString('hex');
    try {
      const node = await q1(
        `INSERT INTO nodes (uuid, name, description, location_id, fqdn, port, scheme, visibility, behind_proxy, file_directory, sftp_port, memory_mb, disk_mb, cpu_cores, memory_overallocate, disk_overallocate, cpu_overallocate, daemon_token)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [genUuid(), name, description || '', location_id || null, fqdn, port || 8080, scheme || 'https',
         visibility || 'public', !!behind_proxy, file_directory || '/var/lib/raven/bots', sftp_port || 2022,
         memory_mb || 0, disk_mb || 0, cpu_cores || 0,
         memory_overallocate ?? 0, disk_overallocate ?? 0, cpu_overallocate ?? 0, token]
      );
      return reply.code(201).send({ node });
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Node name already exists' });
      throw e;
    }
  });

  fastify.patch('/api/admin/nodes/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, location_id, fqdn, port, scheme, visibility, behind_proxy, file_directory, sftp_port, memory_mb, disk_mb, cpu_cores, memory_overallocate, disk_overallocate, cpu_overallocate, enabled } = req.body || {};
    const node = await q1(
      `UPDATE nodes SET name = COALESCE($1, name), description = COALESCE($2, description),
       location_id = COALESCE($3, location_id), fqdn = COALESCE($4, fqdn),
       port = COALESCE($5, port), scheme = COALESCE($6, scheme),
       visibility = COALESCE($7, visibility), behind_proxy = COALESCE($8, behind_proxy),
       file_directory = COALESCE($9, file_directory), sftp_port = COALESCE($10, sftp_port),
       memory_mb = COALESCE($11, memory_mb), disk_mb = COALESCE($12, disk_mb),
       cpu_cores = COALESCE($13, cpu_cores), memory_overallocate = COALESCE($14, memory_overallocate),
       disk_overallocate = COALESCE($15, disk_overallocate), cpu_overallocate = COALESCE($16, cpu_overallocate),
       enabled = COALESCE($17, enabled)
       WHERE id = $18 RETURNING *`,
      [name, description, location_id, fqdn, port, scheme, visibility, behind_proxy, file_directory, sftp_port,
       memory_mb, disk_mb, cpu_cores, memory_overallocate, disk_overallocate, cpu_overallocate, enabled, req.params.id]
    );
    if (!node) return reply.code(404).send({ error: 'Node not found' });
    return { node };
  });

  fastify.delete('/api/admin/nodes/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const servers = await q1(`SELECT count(*)::int AS c FROM servers WHERE node_id = $1`, [req.params.id]);
    if (servers.c > 0) return reply.code(400).send({ error: 'Node has servers — delete them first' });
    await q(`DELETE FROM nodes WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Allocations (ports) ────────────────────────────────────
  fastify.get('/api/admin/nodes/:id/allocations', { preHandler: requireAdmin }, async (req) => {
    const allocations = await q(
      `SELECT a.*, s.identifier AS server_identifier FROM allocations a
       LEFT JOIN servers s ON s.id = a.server_id
       WHERE a.node_id = $1 ORDER BY a.port`,
      [req.params.id]
    );
    return { allocations };
  });

  fastify.post('/api/admin/nodes/:id/allocations', { preHandler: requireAdmin }, async (req, reply) => {
    const { ip, port } = req.body || {};
    const node = await q1(`SELECT * FROM nodes WHERE id = $1`, [req.params.id]);
    if (!node) return reply.code(404).send({ error: 'Node not found' });
    if (!port) return reply.code(400).send({ error: 'port is required' });
    try {
      const alloc = await q1(
        `INSERT INTO allocations (node_id, ip, port) VALUES ($1,$2,$3) RETURNING *`,
        [node.id, ip || '0.0.0.0', port]
      );
      return reply.code(201).send({ allocation: alloc });
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Port already allocated on this node' });
      throw e;
    }
  });

  fastify.post('/api/admin/nodes/:id/allocations/range', { preHandler: requireAdmin }, async (req, reply) => {
    const { ip, from, to } = req.body || {};
    const node = await q1(`SELECT * FROM nodes WHERE id = $1`, [req.params.id]);
    if (!node) return reply.code(404).send({ error: 'Node not found' });
    if (!from || !to || to < from) return reply.code(400).send({ error: 'Valid from/to range required' });
    if (to - from > 1000) return reply.code(400).send({ error: 'Max 1000 ports per range' });
    let added = 0;
    for (let p = from; p <= to; p++) {
      try {
        await q(`INSERT INTO allocations (node_id, ip, port) VALUES ($1,$2,$3) ON CONFLICT (node_id, port) DO NOTHING`, [node.id, ip || '0.0.0.0', p]);
        added++;
      } catch {}
    }
    return { added };
  });

  fastify.delete('/api/admin/allocations/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const alloc = await q1(`SELECT * FROM allocations WHERE id = $1`, [req.params.id]);
    if (!alloc) return reply.code(404).send({ error: 'Allocation not found' });
    if (alloc.server_id) return reply.code(400).send({ error: 'Allocation is in use by a server' });
    await q(`DELETE FROM allocations WHERE id = $1`, [alloc.id]);
    return { ok: true };
  });

  // ── Users ─────────────────────────────────────────────────
  fastify.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const users = await q(
      `SELECT u.id, u.uuid, u.username, u.email, u.root_admin, u.suspended, u.created_at,
              (SELECT count(*)::int FROM servers s WHERE s.user_id = u.id) AS server_count
       FROM users u ORDER BY u.created_at DESC`
    );
    return { users };
  });

  fastify.post('/api/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const { username, email, password, root_admin } = req.body || {};
    if (!username || !email || !password) return reply.code(400).send({ error: 'username, email, password required' });
    const { registerUser } = await import('./auth.js');
    try {
      const user = await registerUser(username, email, password);
      if (root_admin) await q(`UPDATE users SET root_admin = true WHERE id = $1`, [user.id]);
      return reply.code(201).send({ user: { ...user, root_admin: !!root_admin } });
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  fastify.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { username, email, root_admin, suspended, password } = req.body || {};
    const updates = [];
    const params = [];
    if (username !== undefined) { params.push(username); updates.push(`username = $${params.length}`); }
    if (email !== undefined) { params.push(email.toLowerCase()); updates.push(`email = $${params.length}`); }
    if (root_admin !== undefined) { params.push(!!root_admin); updates.push(`root_admin = $${params.length}`); }
    if (suspended !== undefined) { params.push(!!suspended); updates.push(`suspended = $${params.length}`); }
    if (password) {
      const bcrypt = await import('bcryptjs');
      params.push(await bcrypt.hash(password, 10));
      updates.push(`password_hash = $${params.length}`);
    }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' });
    params.push(req.params.id);
    const user = await q1(`UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, username, email, root_admin, suspended`, params);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return { user };
  });

  fastify.delete('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (req.params.id === req.user.id) return reply.code(400).send({ error: 'You cannot delete your own account' });
    await q(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Mounts ──────────────────────────────────────────────────
  fastify.get('/api/admin/mounts', { preHandler: requireAdmin }, async () => {
    const mounts = await q(
      `SELECT m.*, (SELECT count(*)::int FROM mount_servers ms WHERE ms.mount_id = m.id) AS server_count
       FROM mounts m ORDER BY m.created_at DESC`
    );
    return { mounts };
  });

  fastify.post('/api/admin/mounts', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, source, target, read_only } = req.body || {};
    if (!name || !source || !target) return reply.code(400).send({ error: 'name, source, target required' });
    const mount = await q1(
      `INSERT INTO mounts (uuid, name, description, source, target, read_only)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [genUuid(), name, description || '', source, target, !!read_only]
    );
    return reply.code(201).send({ mount });
  });

  fastify.patch('/api/admin/mounts/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, source, target, read_only } = req.body || {};
    const mount = await q1(
      `UPDATE mounts SET name = COALESCE($1, name), description = COALESCE($2, description),
       source = COALESCE($3, source), target = COALESCE($4, target), read_only = COALESCE($5, read_only)
       WHERE id = $6 RETURNING *`,
      [name, description, source, target, read_only, req.params.id]
    );
    if (!mount) return reply.code(404).send({ error: 'Mount not found' });
    return { mount };
  });

  fastify.delete('/api/admin/mounts/:id', { preHandler: requireAdmin }, async (req) => {
    await q(`DELETE FROM mounts WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Full-panel backup ─────────────────────────────────────
  fastify.post('/api/admin/backup', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const result = await agentRequest('/backup', 'POST');
      return result;
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.get('/api/admin/backup', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const result = await agentRequest('/backup', 'GET');
      return result;
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });

  fastify.get('/api/admin/backup/download/:name', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const name = path.basename(req.params.name);
      const agentRes = await agentRequest(`/backup/download/${name}`, 'GET', undefined, { raw: true });
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      reply.type('application/gzip');
      return agentRes.body;
    } catch (e) {
      return reply.code(500).send({ error: e.message });
    }
  });
}
