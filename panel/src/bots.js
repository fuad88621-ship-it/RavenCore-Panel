import { q, q1 } from './db.js';
import crypto from 'node:crypto';
import { agentRequest, consoleToken } from './agent.js';
import { requireAuth } from './auth.js';

function genIdentifier() {
  return crypto.randomBytes(4).toString('hex');
}

async function pickNode(memoryMb, diskMb) {
  const nodes = await q(
    `SELECT * FROM nodes WHERE enabled = true
     ORDER BY (total_memory_mb - allocated_memory_mb) DESC`
  );
  for (const n of nodes) {
    if (n.total_memory_mb - n.allocated_memory_mb >= memoryMb &&
        n.total_disk_mb - n.allocated_disk_mb >= diskMb) {
      return n;
    }
  }
  return null;
}

async function getPlan(user) {
  return q1(`SELECT * FROM plans WHERE id = $1`, [user.plan]);
}

async function getBotForUser(req, reply) {
  const bot = await q1(`SELECT * FROM bots WHERE id = $1`, [req.params.id]);
  if (!bot) {
    reply.code(404).send({ error: 'Bot not found' });
    return null;
  }
  if (req.user.role !== 'admin' && bot.user_id !== req.user.id) {
    reply.code(403).send({ error: 'Not your bot' });
    return null;
  }
  return bot;
}

export async function botRoutes(fastify) {
  // List my bots
  fastify.get('/api/bots', { preHandler: requireAuth }, async (req, reply) => {
    const bots = await q(
      `SELECT b.*, r.name AS runtime_name, n.name AS node_name
       FROM bots b
       JOIN runtimes r ON r.id = b.runtime
       LEFT JOIN nodes n ON n.id = b.node_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    return { bots };
  });

  // Create bot
  fastify.post('/api/bots', { preHandler: requireAuth }, async (req, reply) => {
    const { name, runtime, memory_mb, disk_mb, cpu } = req.body || {};
    if (!name || !runtime) return reply.code(400).send({ error: 'name and runtime are required' });

    const plan = await getPlan(req.user);
    if (!plan) return reply.code(400).send({ error: 'Unknown plan' });

    const myBots = await q(`SELECT count(*)::int AS c FROM bots WHERE user_id = $1`, [req.user.id]);
    if (myBots[0].c >= plan.max_bots) {
      return reply.code(400).send({ error: `Your plan allows ${plan.max_bots} bot(s)` });
    }

    const rt = await q1(`SELECT * FROM runtimes WHERE id = $1`, [runtime]);
    if (!rt) return reply.code(400).send({ error: 'Unknown runtime' });

    const mem = memory_mb || rt.default_memory_mb;
    const disk = disk_mb || rt.default_disk_mb;
    const cpuPct = cpu || rt.default_cpu;
    if (mem > plan.memory_mb || disk > plan.disk_mb || cpuPct > plan.cpu) {
      return reply.code(400).send({ error: 'Requested resources exceed your plan limits' });
    }

    const node = await pickNode(mem, disk);
    if (!node) return reply.code(503).send({ error: 'No node has enough free resources' });

    const identifier = genIdentifier();
    const bot = await q1(
      `INSERT INTO bots (identifier, name, user_id, node_id, runtime, status, memory_mb, disk_mb, cpu, startup_command)
       VALUES ($1,$2,$3,$4,$5,'installing',$6,$7,$8,$9)
       RETURNING *`,
      [identifier, name, req.user.id, node.id, runtime, mem, disk, cpuPct, rt.startup_command]
    );

    // Tell the agent to build the container (async, don't block the response)
    agentRequest('/bots', 'POST', {
      uuid: bot.id,
      identifier,
      image: rt.docker_image,
      startup_command: bot.startup_command,
      install_command: rt.install_command,
      memory_mb: mem,
      disk_mb: disk,
      cpu: cpuPct,
      env: bot.env,
    }).then(async (res) => {
      await q(`UPDATE bots SET container_id = $1, status = 'offline' WHERE id = $2`, [res.container_id, bot.id]);
    }).catch(async (e) => {
      console.error('[bots] agent create failed:', e.message);
      await q(`UPDATE bots SET status = 'suspended' WHERE id = $1`, [bot.id]);
    });

    // Reserve resources on the node
    await q(
      `UPDATE nodes SET allocated_memory_mb = allocated_memory_mb + $1, allocated_disk_mb = allocated_disk_mb + $2 WHERE id = $3`,
      [mem, disk, node.id]
    );

    return reply.code(201).send({ bot });
  });

  // Bot detail
  fastify.get('/api/bots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const rt = await q1(`SELECT * FROM runtimes WHERE id = $1`, [bot.runtime]);
    return { bot: { ...bot, runtime_name: rt?.name } };
  });

  // Delete bot
  fastify.delete('/api/bots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    try {
      await agentRequest(`/bots/${bot.id}`, 'DELETE');
    } catch (e) {
      console.error('[bots] agent delete failed:', e.message);
    }
    await q(`UPDATE nodes SET allocated_memory_mb = GREATEST(allocated_memory_mb - $1, 0), allocated_disk_mb = GREATEST(allocated_disk_mb - $2, 0) WHERE id = $3`, [bot.memory_mb, bot.disk_mb, bot.node_id]);
    await q(`DELETE FROM bots WHERE id = $1`, [bot.id]);
    return { ok: true };
  });

  // Power control
  fastify.post('/api/bots/:id/power', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const { action } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill'].includes(action)) {
      return reply.code(400).send({ error: 'Invalid action' });
    }
    if (bot.status === 'suspended') return reply.code(403).send({ error: 'Bot suspended' });
    const res = await agentRequest(`/bots/${bot.id}/power`, 'POST', { action });
    const status = action === 'start' ? 'running' : action === 'stop' || action === 'kill' ? 'offline' : bot.status;
    await q(`UPDATE bots SET status = $1 WHERE id = $2`, [status, bot.id]);
    return { ok: true, status: res.status || status };
  });

  // Send command to stdin
  fastify.post('/api/bots/:id/command', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const { command } = req.body || {};
    if (!command) return reply.code(400).send({ error: 'command required' });
    await agentRequest(`/bots/${bot.id}/command`, 'POST', { command });
    return { ok: true };
  });

  // Console credentials
  fastify.get('/api/bots/:id/console', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const node = await q1(`SELECT * FROM nodes WHERE id = $1`, [bot.node_id]);
    const token = consoleToken({ uuid: bot.id, identifier: bot.identifier });
    return {
      socket: `wss://${node.fqdn}/bots/${bot.id}/ws?token=${token}`,
      token,
    };
  });

  // Files
  fastify.get('/api/bots/:id/files', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const path = req.query.path || '/';
    return agentRequest(`/bots/${bot.id}/files?path=${encodeURIComponent(path)}`);
  });

  fastify.post('/api/bots/:id/files/read', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    return agentRequest(`/bots/${bot.id}/files/read`, 'POST', req.body);
  });

  fastify.post('/api/bots/:id/files/write', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    return agentRequest(`/bots/${bot.id}/files/write`, 'POST', req.body);
  });

  fastify.post('/api/bots/:id/files/delete', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    return agentRequest(`/bots/${bot.id}/files/delete`, 'POST', req.body);
  });

  fastify.post('/api/bots/:id/files/rename', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    return agentRequest(`/bots/${bot.id}/files/rename`, 'POST', req.body);
  });

  // Env vars
  fastify.post('/api/bots/:id/env', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const env = req.body || {};
    await q(`UPDATE bots SET env = $1 WHERE id = $2`, [JSON.stringify(env), bot.id]);
    // Agent rebuilds the container so the new env actually applies
    await agentRequest(`/bots/${bot.id}/spec`, 'PATCH', { env });
    return { ok: true };
  });

  // Resources
  fastify.get('/api/bots/:id/resources', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    return agentRequest(`/bots/${bot.id}/resources`);
  });

  // Reinstall
  fastify.post('/api/bots/:id/reinstall', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const rt = await q1(`SELECT * FROM runtimes WHERE id = $1`, [bot.runtime]);
    await q(`UPDATE bots SET status = 'installing' WHERE id = $1`, [bot.id]);
    agentRequest(`/bots/${bot.id}/reinstall`, 'POST', {
      image: rt.docker_image,
      install_command: rt.install_command,
    }).then(async () => {
      await q(`UPDATE bots SET status = 'offline' WHERE id = $1`, [bot.id]);
    }).catch(async (e) => {
      console.error('[bots] reinstall failed:', e.message);
      await q(`UPDATE bots SET status = 'suspended' WHERE id = $1`, [bot.id]);
    });
    return { ok: true };
  });

  // Rename / startup command
  fastify.patch('/api/bots/:id', { preHandler: requireAuth }, async (req, reply) => {
    const bot = await getBotForUser(req, reply);
    if (!bot) return;
    const { name, startup_command } = req.body || {};
    const updates = [];
    const params = [];
    if (name) { params.push(name); updates.push(`name = $${params.length}`); }
    if (startup_command) { params.push(startup_command); updates.push(`startup_command = $${params.length}`); }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' });
    params.push(bot.id);
    const updated = await q1(`UPDATE bots SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    // Apply startup command change on the agent (rebuilds container)
    if (startup_command) {
      try {
        await agentRequest(`/bots/${bot.id}/spec`, 'PATCH', { startup_command });
      } catch (e) {
        console.error('[bots] spec update failed:', e.message);
      }
    }
    return { bot: updated };
  });
}
