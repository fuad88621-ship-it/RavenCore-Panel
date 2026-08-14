import { q, q1, genUuid, genIdentifier } from './db.js';
import crypto from 'node:crypto';
import { requireAdmin } from './auth.js';
import { agentRequest } from './agent-client.js';
import { config } from './config.js';

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

// Replace {{VAR}} placeholders in the egg startup command with env values,
// including Pterodactyl-style system substitutes.
export function renderStartup(template, env, extras = {}) {
  const all = { ...env, ...extras };
  return (template || '').replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, name) => all[name] ?? m);
}

async function getServerWithDetails(id) {
  return q1(
    `SELECT s.*, u.username AS owner_username, u.email AS owner_email,
            n.name AS node_name, n.fqdn AS node_fqdn,
            e.name AS egg_name, e.docker_image AS egg_image, e.startup_command AS egg_startup,
            e.default_install_command AS egg_install, e.skip_install AS egg_skip_install,
            nest.name AS nest_name
     FROM servers s
     JOIN users u ON u.id = s.user_id
     JOIN nodes n ON n.id = s.node_id
     JOIN eggs e ON e.id = s.egg_id
     JOIN nests nest ON nest.id = s.nest_id
     WHERE s.id = $1`,
    [id]
  );
}

export async function adminServerRoutes(fastify) {
  // List servers
  fastify.get('/api/admin/servers', { preHandler: requireAdmin }, async (req) => {
    const { search } = req.query;
    let servers;
    if (search) {
      servers = await q(
        `SELECT s.*, u.username AS owner_username, n.name AS node_name, e.name AS egg_name
         FROM servers s
         JOIN users u ON u.id = s.user_id
         JOIN nodes n ON n.id = s.node_id
         JOIN eggs e ON e.id = s.egg_id
         WHERE s.name ILIKE $1 OR s.identifier ILIKE $1 OR u.username ILIKE $1 OR u.email ILIKE $1
         ORDER BY s.created_at DESC LIMIT 50`,
        [`%${search}%`]
      );
    } else {
      servers = await q(
        `SELECT s.*, u.username AS owner_username, n.name AS node_name, e.name AS egg_name
         FROM servers s
         JOIN users u ON u.id = s.user_id
         JOIN nodes n ON n.id = s.node_id
         JOIN eggs e ON e.id = s.egg_id
         ORDER BY s.created_at DESC LIMIT 100`
      );
    }
    return { servers };
  });

  // Server detail
  fastify.get('/api/admin/servers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await getServerWithDetails(req.params.id);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1 ORDER BY created_at`, [server.egg_id]);
    const databases = await q(`SELECT * FROM server_databases WHERE server_id = $1`, [server.id]);
    const mounts = await q(
      `SELECT m.* FROM mounts m JOIN mount_servers ms ON ms.mount_id = m.id WHERE ms.server_id = $1`,
      [server.id]
    );
    return { server, variables, databases, mounts };
  });

  // Create server
  fastify.post('/api/admin/servers', { preHandler: requireAdmin }, async (req, reply) => {
    const {
      user_id, node_id, egg_id, name, description,
      memory_mb, cpu, cpu_pinning, disk_mb, swap_mb, io, databases, allocations, backups,
      env, startup_command, docker_image, skip_install, start_on_install, oom_killer,
      default_allocation_id, additional_allocation_ids,
    } = req.body || {};

    if (!user_id || !egg_id || !name) {
      return reply.code(400).send({ error: 'user_id, egg_id and name are required' });
    }

    const user = await q1(`SELECT * FROM users WHERE id = $1`, [user_id]);
    const egg = await q1(`SELECT * FROM eggs WHERE id = $1`, [egg_id]);
    if (!user) return reply.code(400).send({ error: 'User not found' });
    if (!egg) return reply.code(400).send({ error: 'Egg not found' });

    // Auto-deploy: pick the best node if none specified
    let node = null;
    if (node_id) {
      node = await q1(`SELECT * FROM nodes WHERE id = $1 AND enabled = true`, [node_id]);
    } else {
      const nodes = await q(
        `SELECT * FROM nodes WHERE enabled = true AND visibility = 'public'
         ORDER BY (memory_mb - COALESCE((SELECT SUM(s2.memory_mb) FROM servers s2 WHERE s2.node_id = nodes.id), 0)) DESC`
      );
      node = nodes[0] || null;
    }
    if (!node) return reply.code(400).send({ error: 'No available node (enable a public node or pick one)' });

    const d = config.defaults;
    const mem = memory_mb || d.memory_mb;
    const cpuPct = cpu || d.cpu;
    const disk = disk_mb || d.disk_mb;
    const swap = swap_mb ?? d.swap_mb;
    const ioVal = io || d.io;
    const dbCount = databases ?? d.databases;
    const allocCount = allocations ?? d.allocations;
    const backupCount = backups ?? d.backups;

    // Check node capacity (with overallocation; -1 = unlimited check)
    const used = await q1(
      `SELECT COALESCE(SUM(memory_mb),0)::int AS mem, COALESCE(SUM(disk_mb),0)::int AS disk, COALESCE(SUM(cpu),0)::int AS cpu
       FROM servers WHERE node_id = $1`,
      [node.id]
    );
    const memCap = node.memory_overallocate === -1 ? Infinity : node.memory_mb + Math.round(node.memory_mb * node.memory_overallocate / 100);
    const diskCap = node.disk_overallocate === -1 ? Infinity : node.disk_mb + Math.round(node.disk_mb * node.disk_overallocate / 100);
    const cpuCap = node.cpu_overallocate === -1 ? Infinity : node.cpu_cores * 100 + Math.round(node.cpu_cores * 100 * node.cpu_overallocate / 100);
    if (used.mem + mem > memCap) return reply.code(400).send({ error: 'Node out of memory' });
    if (used.disk + disk > diskCap) return reply.code(400).send({ error: 'Node out of disk' });
    if (used.cpu + cpuPct > cpuCap) return reply.code(400).send({ error: 'Node out of CPU' });

    // Merge egg variable defaults with provided env
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1`, [egg.id]);
    const mergedEnv = {};
    for (const v of variables) mergedEnv[v.env_variable] = v.default_value;
    for (const [k, val] of Object.entries(env || {})) mergedEnv[k] = val;

    // Assign default + additional allocations first (need the port for substitutes)
    let defaultPort = null;
    if (default_allocation_id) {
      const alloc = await q1(`SELECT * FROM allocations WHERE id = $1 AND node_id = $2 AND server_id IS NULL`, [default_allocation_id, node.id]);
      if (alloc) {
        defaultPort = alloc.port;
        await q(`UPDATE allocations SET server_id = $1 WHERE id = $2`, [null, alloc.id]); // claim later after insert
      }
    }
    const extras = {
      SERVER_MEMORY: String(mem),
      SERVER_IP: node.fqdn,
      SERVER_PORT: String(defaultPort || ''),
    };

    const finalStartup = startup_command || renderStartup(egg.startup_command, mergedEnv, extras);
    const finalImage = docker_image || egg.docker_image;

    const uuid = genUuid();
    const identifier = genIdentifier();
    const sftpPassword = crypto.randomBytes(12).toString('hex');
    const server = await q1(
      `INSERT INTO servers (uuid, identifier, name, description, user_id, node_id, nest_id, egg_id,
        status, memory_mb, cpu, cpu_pinning, disk_mb, swap_mb, io, oom_killer, databases, allocations, backups,
        startup_command, docker_image, skip_install, start_on_install, env, sftp_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'installing',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [uuid, identifier, name, description || '', user.id, node.id, egg.nest_id, egg.id,
       mem, cpuPct, cpu_pinning || '', disk, swap, ioVal, oom_killer !== false, dbCount, allocCount, backupCount,
       finalStartup, finalImage, !!skip_install, !!start_on_install, JSON.stringify(mergedEnv), sftpPassword]
    );

    // Claim allocations
    const allocIds = [default_allocation_id, ...(additional_allocation_ids || [])].filter(Boolean);
    let claimed = 0;
    for (const aId of allocIds) {
      if (claimed >= allocCount) break;
      const alloc = await q1(`SELECT * FROM allocations WHERE id = $1 AND node_id = $2 AND server_id IS NULL`, [aId, node.id]);
      if (alloc) {
        await q(`UPDATE allocations SET server_id = $1 WHERE id = $2`, [server.id, alloc.id]);
        claimed++;
      }
    }
    // Fill remaining allocation slots from free ports on the node
    if (claimed < allocCount) {
      const free = await q(
        `SELECT * FROM allocations WHERE node_id = $1 AND server_id IS NULL ORDER BY port LIMIT $2`,
        [node.id, allocCount - claimed]
      );
      for (const a of free) {
        await q(`UPDATE allocations SET server_id = $1 WHERE id = $2`, [server.id, a.id]);
      }
    }

    // Tell the agent to build the container
    agentRequest('/servers', 'POST', {
      uuid: server.uuid,
      identifier,
      image: finalImage,
      startup_command: finalStartup,
      install_command: skip_install ? null : egg.default_install_command,
      memory_mb: mem,
      disk_mb: disk,
      cpu: cpuPct,
      cpu_pinning: cpu_pinning || '',
      oom_killer: oom_killer !== false,
      swap_mb: swap,
      io: ioVal,
      env: mergedEnv,
      mounts: [],
      mount_target: egg.mount_target || '/home/container',
      sftp_password: sftpPassword,
    }).then(async (res) => {
      await q(`UPDATE servers SET container_id = $1, status = 'offline' WHERE id = $2`, [res.container_id, server.id]);
      // Auto-start when installed if requested
      if (start_on_install) {
        try {
          await agentRequest(`/servers/${server.uuid}/power`, 'POST', { action: 'start' });
          await q(`UPDATE servers SET status = 'running' WHERE id = $1`, [server.id]);
        } catch {}
      }
    }).catch(async (e) => {
      console.error('[admin] agent create failed:', e.message);
      await q(`UPDATE servers SET status = 'install_failed' WHERE id = $1`, [server.id]);
    });

    await logActivity(server.id, req.user.id, 'server.create', { name: server.name });

    return reply.code(201).send({ server });
  });

  // Update server
  fastify.patch('/api/admin/servers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, memory_mb, cpu, disk_mb, swap_mb, io, databases, allocations, backups, startup_command, docker_image, env } = req.body || {};
    const updates = [];
    const params = [];
    const set = (v, col) => { if (v !== undefined) { params.push(v); updates.push(`${col} = $${params.length}`); } };
    set(name, 'name'); set(description, 'description');
    set(memory_mb, 'memory_mb'); set(cpu, 'cpu'); set(disk_mb, 'disk_mb');
    set(swap_mb, 'swap_mb'); set(io, 'io'); set(databases, 'databases');
    set(allocations, 'allocations'); set(backups, 'backups');
    set(startup_command, 'startup_command'); set(docker_image, 'docker_image');
    if (env !== undefined) { params.push(JSON.stringify(env)); updates.push(`env = $${params.length}`); }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' });
    params.push(req.params.id);
    const server = await q1(`UPDATE servers SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    // Apply spec changes on the agent (rebuilds container)
    if (startup_command !== undefined || env !== undefined || docker_image !== undefined || memory_mb !== undefined || cpu !== undefined || disk_mb !== undefined) {
      try {
        await agentRequest(`/servers/${server.uuid}/spec`, 'PATCH', {
          startup_command: startup_command !== undefined ? startup_command : server.startup_command,
          env: env !== undefined ? env : server.env,
          image: docker_image !== undefined ? docker_image : server.docker_image,
          memory_mb: memory_mb !== undefined ? memory_mb : server.memory_mb,
          cpu: cpu !== undefined ? cpu : server.cpu,
          disk_mb: disk_mb !== undefined ? disk_mb : server.disk_mb,
        });
      } catch (e) {
        console.error('[admin] spec update failed:', e.message);
      }
    }
    return { server };
  });

  // Delete server
  fastify.delete('/api/admin/servers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try {
      await agentRequest(`/servers/${server.uuid}`, 'DELETE');
    } catch (e) {
      console.error('[admin] agent delete failed:', e.message);
    }
    await q(`UPDATE allocations SET server_id = NULL WHERE server_id = $1`, [server.id]);
    await q(`DELETE FROM servers WHERE id = $1`, [server.id]);
    return { ok: true };
  });

  // Power control
  fastify.post('/api/admin/servers/:id/power', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const { action } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    if (server.status === 'suspended') return reply.code(403).send({ error: 'Server suspended' });
    const res = await agentRequest(`/servers/${server.uuid}/power`, 'POST', { action });
    const status = action === 'start' ? 'running' : (action === 'stop' || action === 'kill') ? 'offline' : server.status;
    await q(`UPDATE servers SET status = $1 WHERE id = $2`, [status, server.id]);
    return { ok: true, status: res.status || status };
  });

  // Suspend / unsuspend
  fastify.post('/api/admin/servers/:id/suspend', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try { await agentRequest(`/servers/${server.uuid}/power`, 'POST', { action: 'kill' }); } catch {}
    await q(`UPDATE servers SET status = 'suspended' WHERE id = $1`, [server.id]);
    return { ok: true };
  });

  fastify.post('/api/admin/servers/:id/unsuspend', { preHandler: requireAdmin }, async (req, reply) => {
    await q(`UPDATE servers SET status = 'offline' WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // Reinstall
  fastify.post('/api/admin/servers/:id/reinstall', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await getServerWithDetails(req.params.id);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    await q(`UPDATE servers SET status = 'installing' WHERE id = $1`, [server.id]);
    agentRequest(`/servers/${server.uuid}/reinstall`, 'POST', {
      image: server.egg_image,
      install_command: server.egg_skip_install ? null : server.egg_install,
    }).then(async () => {
      await q(`UPDATE servers SET status = 'offline' WHERE id = $1`, [server.id]);
    }).catch(async (e) => {
      console.error('[admin] reinstall failed:', e.message);
      await q(`UPDATE servers SET status = 'install_failed' WHERE id = $1`, [server.id]);
    });
    return { ok: true };
  });
}
