import { q, q1, genUuid, genIdentifier } from './db.js';
import crypto from 'node:crypto';
import { requireAdmin } from './auth.js';
import { agentRequest, agentRequestFor, agentRequestStream } from './agent-client.js';
import { config, agentInternalUrl } from './config.js';
import { deleteDatabase } from './admin-databases.js';

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

// Validate an env value against an egg variable's rules string
// (e.g. "required|string|max:20" or "required|integer|min:1|max:65535").
// Returns an error message or null if valid.
export function validateRules(rules, value) {
  if (!rules) return null;
  const parts = String(rules).split('|');
  for (const part of parts) {
    const [rule, arg] = part.split(':');
    switch (rule) {
      case 'required':
        if (value === undefined || value === null || value === '') return 'This field is required';
        break;
      case 'string':
        break;
      case 'integer':
        if (!/^-?\d+$/.test(String(value))) return 'Must be an integer';
        break;
      case 'numeric':
        if (isNaN(Number(value))) return 'Must be a number';
        break;
      case 'min':
        // Pterodactyl rules use min/max for both numbers and string lengths.
        if (isNaN(Number(value))) {
          if (String(value).length < Number(arg)) return `Must be at least ${arg} characters`;
        } else if (Number(value) < Number(arg)) {
          return `Must be at least ${arg}`;
        }
        break;
      case 'max':
        if (isNaN(Number(value))) {
          if (String(value).length > Number(arg)) return `Must be at most ${arg} characters`;
        } else if (Number(value) > Number(arg)) {
          return `Must be at most ${arg}`;
        }
        break;
      case 'min_length':
        if (String(value).length < Number(arg)) return `Must be at least ${arg} characters`;
        break;
      case 'max_length':
        if (String(value).length > Number(arg)) return `Must be at most ${arg} characters`;
        break;
      case 'url':
        if (!/^https?:\/\//.test(String(value))) return 'Must be a valid URL';
        break;
      case 'boolean':
        if (!['true', 'false', '0', '1'].includes(String(value))) return 'Must be a boolean';
        break;
    }
  }
  return null;
}

async function getServerWithDetails(id) {
  return q1(
    `SELECT s.*, u.username AS owner_username, u.email AS owner_email,
            n.name AS node_name, n.fqdn AS node_fqdn,
            e.name AS egg_name, e.docker_image AS egg_image, e.startup_command AS egg_startup,
            e.default_install_command AS egg_install, e.skip_install AS egg_skip_install,
            nest.name AS nest_name
     FROM servers s
     LEFT JOIN users u ON u.id = s.user_id
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
         LEFT JOIN users u ON u.id = s.user_id
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
         LEFT JOIN users u ON u.id = s.user_id
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

    if (!egg_id || !name) {
      return reply.code(400).send({ error: 'egg_id and name are required' });
    }

    const user = user_id ? await q1(`SELECT * FROM users WHERE id = $1`, [user_id]) : null;
    const egg = await q1(`SELECT * FROM eggs WHERE id = $1`, [egg_id]);
    if (user_id && !user) return reply.code(400).send({ error: 'User not found' });
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

    // The node must have enough free allocations (excluding ports used by
    // other nodes on the same host) — otherwise the server would be created
    // with no port.
    if (allocCount > 0) {
      const freeCount = await q1(
        `SELECT count(*)::int AS c FROM allocations a
         WHERE a.node_id = $1 AND a.server_id IS NULL
         AND a.port NOT IN (
           SELECT a2.port FROM allocations a2
           JOIN servers s ON s.id = a2.server_id
           JOIN nodes n ON n.id = a2.node_id
           WHERE n.fqdn = (SELECT fqdn FROM nodes WHERE id = $1)
             AND a2.port IS NOT NULL
         )`,
        [node.id]
      );
      if ((freeCount?.c || 0) < allocCount) {
        return reply.code(400).send({ error: `Node has only ${freeCount?.c || 0} free allocation(s) but ${allocCount} requested. Add ports to the node first.` });
      }
    }

    // Merge egg variable defaults with provided env
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1`, [egg.id]);
    const mergedEnv = {};
    for (const v of variables) mergedEnv[v.env_variable] = v.default_value;
    for (const [k, val] of Object.entries(env || {})) mergedEnv[k] = val;
    // Validate provided env values against the egg variable rules.
    for (const v of variables) {
      if (env && env[v.env_variable] !== undefined) {
        const err = validateRules(v.rules, env[v.env_variable]);
        if (err) return reply.code(400).send({ error: `${v.name}: ${err}` });
      }
    }

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
      [uuid, identifier, name, description || '', user?.id || null, node.id, egg.nest_id, egg.id,
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
    // Fill remaining allocation slots from free ports on the node. Exclude
    // ports used by servers on other nodes sharing the same host (same fqdn)
    // so two nodes on one VPS can't collide on the physical port.
    if (claimed < allocCount) {
      const free = await q(
        `SELECT a.* FROM allocations a
         WHERE a.node_id = $1 AND a.server_id IS NULL
         AND a.port NOT IN (
           SELECT a2.port FROM allocations a2
           JOIN servers s ON s.id = a2.server_id
           JOIN nodes n ON n.id = a2.node_id
           WHERE n.fqdn = (SELECT fqdn FROM nodes WHERE id = $1)
             AND a2.port IS NOT NULL
         )
         ORDER BY a.port LIMIT $2`,
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
      allocation_port: defaultPort,
    }, { node }).then(async (res) => {
      await q(`UPDATE servers SET container_id = $1, status = 'offline' WHERE id = $2`, [res.container_id, server.id]);
      // Auto-start when installed if requested
      if (start_on_install) {
        try {
          await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action: 'start' });
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

  // Assign an unassigned server to a user
  fastify.patch('/api/admin/servers/:id/assign', { preHandler: requireAdmin }, async (req, reply) => {
    const { user_id } = req.body || {};
    if (!user_id) return reply.code(400).send({ error: 'user_id is required' });
    const user = await q1(`SELECT * FROM users WHERE id = $1`, [user_id]);
    if (!user) return reply.code(404).send({ error: 'User not found' });
    const server = await q1(`UPDATE servers SET user_id = $1 WHERE id = $2 RETURNING *`, [user_id, req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    await logActivity(server.id, req.user.id, 'server.assign', { to_user_id: user_id, to_username: user.username });
    return { server };
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
        await agentRequestFor(server.uuid, `/servers/${server.uuid}/spec`, 'PATCH', {
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
      await agentRequestFor(server.uuid, `/servers/${server.uuid}`, 'DELETE');
    } catch (e) {
      console.error('[admin] agent delete failed:', e.message);
    }
    // Drop the server's MariaDB databases — the FK cascades the rows, but the
    // actual MySQL databases would otherwise be orphaned forever.
    const dbs = await q(`SELECT * FROM server_databases WHERE server_id = $1`, [server.id]);
    for (const db of dbs) {
      try { await deleteDatabase(db); } catch (e) { console.error('[admin] db cleanup failed:', e.message); }
    }
    await q(`UPDATE allocations SET server_id = NULL WHERE server_id = $1`, [server.id]);
    await q(`DELETE FROM servers WHERE id = $1`, [server.id]);
    return { ok: true };
  });

  // ── Transfer a server to another node ───────────────────────────────
  // Stop on source → create on destination (offline) → move files (relayed
  // through the panel so remote→local works too) → delete source container →
  // re-point allocations/DB → auto-start if it was running. The transfer runs
  // asynchronously; the client polls GET /api/admin/transfers/:id for a live
  // progress bar.
  const transfers = new Map(); // id -> { id, status, stage, percent, error }

  fastify.get('/api/admin/transfers/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const t = transfers.get(req.params.id);
    if (!t) return reply.code(404).send({ error: 'Transfer not found' });
    return { transfer: { id: t.id, status: t.status, stage: t.stage, percent: t.percent, error: t.error || null } };
  });

  async function runTransfer(entry, server, src, dest, egg, userId) {
    const setP = (stage, percent = null) => {
      entry.stage = stage;
      if (percent !== null) entry.percent = Math.min(100, Math.max(0, percent));
    };
    const wasRunning = server.status === 'running';
    const wasSuspended = server.status === 'suspended';
    const isLocalSrc = src.name === config.node.name || src.fqdn === config.node.fqdn;
    const isLocalDest = dest.name === config.node.name || dest.fqdn === config.node.fqdn;
    const sameAgent = (isLocalSrc && isLocalDest)
      || (src.fqdn === dest.fqdn && src.port === dest.port && (src.scheme || 'http') === (dest.scheme || 'http'));

    try {
      // 1. Stop on the source node (expected stop — crash monitor won't restart it)
      setP('stopping', 5);
      try { await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action: 'stop' }); } catch {}

      // 2. Pick a free allocation on the destination node. Exclude ports that
      // are in use by servers on OTHER nodes sharing the same host (same fqdn)
      // — e.g. two nodes on one VPS with overlapping port ranges would
      // otherwise collide on the physical port.
      const free = await q1(
        `SELECT a.* FROM allocations a
         WHERE a.node_id = $1 AND a.server_id IS NULL
         AND a.port NOT IN (
           SELECT a2.port FROM allocations a2
           JOIN servers s ON s.id = a2.server_id
           JOIN nodes n ON n.id = a2.node_id
           WHERE n.fqdn = (SELECT fqdn FROM nodes WHERE id = $1)
             AND a2.port IS NOT NULL
         )
         ORDER BY a.port LIMIT 1`,
        [dest.id]
      );
      const newPort = free ? free.port : null;

      // 3. Create the container on the destination (no install, stays offline).
      // Re-render the startup command with the NEW port — the old command has
      // the source port baked in (e.g. Minecraft's PORT={{SERVER_PORT}}), so a
      // server moved to a different port would otherwise keep listening on the
      // old one.
      setP('creating', 15);
      const newStartup = renderStartup(egg?.startup_command || server.startup_command, server.env, {
        SERVER_MEMORY: String(server.memory_mb),
        SERVER_IP: dest.fqdn,
        SERVER_PORT: String(newPort || ''),
      });
      const createRes = await agentRequest('/servers', 'POST', {
        uuid: server.uuid,
        identifier: server.identifier,
        image: server.docker_image,
        startup_command: newStartup,
        install_command: null,
        memory_mb: server.memory_mb,
        disk_mb: server.disk_mb,
        cpu: server.cpu,
        cpu_pinning: server.cpu_pinning || '',
        oom_killer: server.oom_killer !== false,
        io: server.io,
        env: server.env,
        mounts: [],
        mount_target: (egg && egg.mount_target) || '/home/container',
        sftp_password: server.sftp_password,
        allocation_port: newPort,
        should_run: false,
      }, { node: dest });

      // 4. Move the files (only for cross-agent transfers; same-agent shares
      // the data dir so the files are already in place and the dest createBot
      // already removed the same-named source container). The panel relays the
      // tar stream source → destination so every host combination works
      // (including remote→local), and byte-counts it for the progress bar.
      if (!sameAgent) {
        setP('moving', 20);
        const srcRes = await agentRequestFor(server.uuid, `/servers/${server.uuid}/transfer/download`, 'GET', undefined, { raw: true });
        const total = Number(srcRes.headers['content-length'] || 0);
        let sent = 0;
        const tracked = new TransformStream({
          transform: (chunk, controller) => {
            sent += chunk.byteLength;
            if (total > 0) setP('moving', 20 + Math.round((sent / total) * 75));
            controller.enqueue(chunk);
          },
        });
        try {
          await agentRequestStream(`/servers/${server.uuid}/files/import`, 'POST', srcRes.body.pipeThrough(tracked), { node: dest });
        } catch (e) {
          // Roll back: remove the half-created destination container (its
          // fresh data dir goes with it — no real files were moved yet)
          try { await agentRequest(`/servers/${server.uuid}`, 'DELETE', undefined, { node: dest }); } catch {}
          throw new Error(`File transfer failed: ${e.message}`);
        }
        setP('cleaning', 96);
        // 5. Remove the source container (its data dir goes with it — files already moved)
        try { await agentRequestFor(server.uuid, `/servers/${server.uuid}`, 'DELETE'); } catch {}
      }

      // 6. Re-point allocations
      setP('updating', 97);
      await q(`UPDATE allocations SET server_id = NULL WHERE node_id = $1 AND server_id = $2`, [src.id, server.id]);
      if (free) {
        await q(`UPDATE allocations SET server_id = $1 WHERE id = $2`, [server.id, free.id]);
      }

      // 7. Update the server record (also persist the re-rendered startup so
      // the DB matches what the container actually runs)
      await q(
        `UPDATE servers SET node_id = $1, container_id = $2, status = $3, startup_command = $4, updated_at = now() WHERE id = $5`,
        [dest.id, createRes.container_id, wasSuspended ? 'suspended' : 'offline', newStartup, server.id]
      );

      // 8. Auto-start if it was running
      if (wasRunning) {
        setP('starting', 99);
        try {
          await agentRequest(`/servers/${server.uuid}/power`, 'POST', { action: 'start' }, { node: dest });
          await q(`UPDATE servers SET status = 'running' WHERE id = $1`, [server.id]);
        } catch {}
      }

      await logActivity(server.id, userId, 'server_transferred', {
        name: server.name,
        from: src.name,
        to: dest.name,
        port: newPort,
      });
      setP('done', 100);
      entry.status = 'done';
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message || String(e);
      // Best-effort recovery: if the DB still points at the source node, try
      // to bring the server back up where it was.
      try {
        const cur = await q1(`SELECT * FROM servers WHERE id = $1`, [server.id]);
        if (cur && cur.node_id === src.id && (cur.status === 'running' || wasRunning)) {
          await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action: 'start' });
          await q(`UPDATE servers SET status = 'running' WHERE id = $1`, [server.id]);
        }
      } catch {}
    }
  }

  fastify.post('/api/admin/servers/:id/transfer', { preHandler: requireAdmin }, async (req, reply) => {
    const { node_id } = req.body || {};
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (!node_id) return reply.code(400).send({ error: 'node_id is required' });
    const dest = await q1(`SELECT * FROM nodes WHERE id = $1 AND enabled = true`, [node_id]);
    if (!dest) return reply.code(400).send({ error: 'Destination node not found or disabled' });
    if (dest.id === server.node_id) return reply.code(400).send({ error: 'Server is already on that node' });
    const src = await q1(`SELECT * FROM nodes WHERE id = $1`, [server.node_id]);
    if (!src) return reply.code(400).send({ error: 'Source node not found' });
    const egg = await q1(`SELECT mount_target, startup_command FROM eggs WHERE id = $1`, [server.egg_id]);

    // Destination capacity check (same logic as create)
    const used = await q1(
      `SELECT COALESCE(SUM(memory_mb),0)::int AS mem, COALESCE(SUM(disk_mb),0)::int AS disk, COALESCE(SUM(cpu),0)::int AS cpu
       FROM servers WHERE node_id = $1`,
      [dest.id]
    );
    const memCap = dest.memory_overallocate === -1 ? Infinity : dest.memory_mb + Math.round(dest.memory_mb * dest.memory_overallocate / 100);
    const diskCap = dest.disk_overallocate === -1 ? Infinity : dest.disk_mb + Math.round(dest.disk_mb * dest.disk_overallocate / 100);
    const cpuCap = dest.cpu_overallocate === -1 ? Infinity : dest.cpu_cores * 100 + Math.round(dest.cpu_cores * 100 * dest.cpu_overallocate / 100);
    if (used.mem + server.memory_mb > memCap) return reply.code(400).send({ error: 'Destination node out of memory' });
    if (used.disk + server.disk_mb > diskCap) return reply.code(400).send({ error: 'Destination node out of disk' });
    if (used.cpu + server.cpu > cpuCap) return reply.code(400).send({ error: 'Destination node out of CPU' });

    // Verify the destination agent is reachable AND supports transfers BEFORE
    // stopping the source server — a bad/outdated destination must never leave
    // the server offline.
    let destHealth = null;
    try {
      destHealth = await agentRequest('/health', 'GET', undefined, { node: dest });
    } catch (e) {
      return reply.code(400).send({ error: `Destination agent unreachable: ${e.message}` });
    }
    if (!destHealth.features || !destHealth.features.includes('transfer')) {
      return reply.code(400).send({
        error: 'Destination agent is outdated (no transfer support). Update it on the node with: bash <(curl -fsSL https://raw.githubusercontent.com/fuad88621-ship-it/RavenCore-Panel/main/install.sh) --update',
      });
    }

    // The destination must have a free allocation (excluding ports used by
    // other nodes on the same host) — otherwise the server would end up with
    // no port after the move.
    const freeAlloc = await q1(
      `SELECT a.id FROM allocations a
       WHERE a.node_id = $1 AND a.server_id IS NULL
       AND a.port NOT IN (
         SELECT a2.port FROM allocations a2
         JOIN servers s ON s.id = a2.server_id
         JOIN nodes n ON n.id = a2.node_id
         WHERE n.fqdn = (SELECT fqdn FROM nodes WHERE id = $1)
           AND a2.port IS NOT NULL
       )
       ORDER BY a.port LIMIT 1`,
      [dest.id]
    );
    if (!freeAlloc) {
      return reply.code(400).send({ error: 'Destination node has no free allocations. Add ports to it first (Admin → Nodes → Allocations).' });
    }

    // Start the transfer in the background and return a transfer id to poll.
    const transferId = crypto.randomUUID();
    const entry = { id: transferId, status: 'running', stage: 'starting', percent: 0, error: null };
    transfers.set(transferId, entry);
    runTransfer(entry, server, src, dest, egg, req.user.id).catch((e) => {
      entry.status = 'error';
      entry.error = e.message || String(e);
    });
    return { transferId };
  });

  // Power control
  fastify.post('/api/admin/servers/:id/power', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const { action } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    if (server.status === 'suspended') return reply.code(403).send({ error: 'Server suspended' });
    const res = await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action });
    const status = action === 'start' ? 'running' : (action === 'stop' || action === 'kill') ? 'offline' : server.status;
    await q(`UPDATE servers SET status = $1 WHERE id = $2`, [status, server.id]);
    return { ok: true, status: res.status || status };
  });

  // Suspend / unsuspend
  fastify.post('/api/admin/servers/:id/suspend', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try { await agentRequestFor(server.uuid, `/servers/${server.uuid}/power`, 'POST', { action: 'kill' }); } catch {}
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
    agentRequestFor(server.uuid, `/servers/${server.uuid}/reinstall`, 'POST', {
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
