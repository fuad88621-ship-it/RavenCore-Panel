import { q, q1 } from './db.js';
import { requireAuth } from './auth.js';
import { agentRequest, agentRequestFor } from './agent-client.js';

// ── Simple 5-field cron matcher (minute hour day month weekday) ──
function cronMatches(cron, date) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const m = date.getMinutes();
  const h = date.getHours();
  const d = date.getDate();
  const mo = date.getMonth() + 1;
  const w = date.getDay();
  return fieldMatch(min, m) && fieldMatch(hour, h) && fieldMatch(dom, d) && fieldMatch(mon, mo) && fieldMatch(dow, w);
}

function fieldMatch(pattern, value) {
  if (pattern === '*') return true;
  for (const part of pattern.split(',')) {
    if (part === '*') return true;
    if (part.includes('/')) {
      const [base, step] = part.split('/');
      const start = base === '*' ? 0 : parseInt(base);
      if (value >= start && (value - start) % parseInt(step) === 0) return true;
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (value >= a && value <= b) return true;
    } else if (parseInt(part) === value) {
      return true;
    }
  }
  return false;
}

// ── Scheduler loop ──
let schedulerTimer = null;

export function startScheduler() {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(runDueSchedules, 30000);
  console.log('[scheduler] started');
}

async function runDueSchedules() {
  try {
    const schedules = await q(
      `SELECT s.*, sv.uuid AS server_uuid, sv.identifier AS server_identifier
       FROM schedules s JOIN servers sv ON sv.id = s.server_id
       WHERE s.is_active = true`
    );
    const now = new Date();
    for (const sched of schedules) {
      if (!cronMatches(sched.cron, now)) continue;
      // Avoid double-running within the same minute
      if (sched.last_run_at && new Date(sched.last_run_at).getTime() > now.getTime() - 60000) continue;
      const tasks = await q(`SELECT * FROM schedule_tasks WHERE schedule_id = $1 ORDER BY sequence`, [sched.id]);
      for (const task of tasks) {
        try {
          await executeTask(sched, task);
        } catch (e) {
          console.error(`[scheduler] task failed (${sched.name}):`, e.message);
        }
      }
      await q(`UPDATE schedules SET last_run_at = now() WHERE id = $1`, [sched.id]);
    }
  } catch (e) {
    console.error('[scheduler] error:', e.message);
  }
}

async function executeTask(sched, task) {
  switch (task.action) {
    case 'start':
    case 'stop':
    case 'restart':
    case 'kill':
      await agentRequestFor(sched.server_uuid, `/servers/${sched.server_uuid}/power`, 'POST', { action: task.action });
      // Keep the DB status in sync — scheduled power actions were leaving
      // the status stale (e.g. container running but panel showing offline).
      await q(`UPDATE servers SET status = $1 WHERE id = $2`, [task.action === 'start' || task.action === 'restart' ? 'running' : 'offline', sched.server_id]);
      break;
    case 'command':
      await agentRequestFor(sched.server_uuid, `/servers/${sched.server_uuid}/command`, 'POST', { command: task.payload });
      break;
  }
}

// ── Routes ──────────────────────────────────────────────────
async function getServerForUser(req, reply) {
  const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
  if (!server) { reply.code(404).send({ error: 'Server not found' }); return null; }
  if (req.user.root_admin || server.user_id === req.user.id) return server;
  const su = await q1(
    `SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2`,
    [server.id, req.user.id]
  );
  if (!su) { reply.code(403).send({ error: 'Not your server' }); return null; }
  server.subuser_permissions = su.permissions || [];
  return server;
}

function can(server, perm) {
  if (!server.subuser_permissions) return true;
  return server.subuser_permissions.includes(perm);
}

// Check a subuser's permission for a schedule/task that belongs to a server.
async function canManage(req, reply, serverId, perm) {
  if (req.user.root_admin) return true;
  const owner = await q1(`SELECT user_id FROM servers WHERE id = $1`, [serverId]);
  if (owner && owner.user_id === req.user.id) return true;
  const su = await q1(`SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2`, [serverId, req.user.id]);
  if (su && (su.permissions || []).includes(perm)) return true;
  reply.code(403).send({ error: `Missing permission: ${perm}` });
  return false;
}

export async function scheduleRoutes(fastify) {
  fastify.get('/api/client/servers/:id/schedules', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'schedules')) return reply.code(403).send({ error: 'Missing permission: schedules' });
    const schedules = await q(
      `SELECT s.*, (SELECT count(*)::int FROM schedule_tasks t WHERE t.schedule_id = s.id) AS task_count
       FROM schedules s WHERE s.server_id = $1 ORDER BY s.created_at DESC`,
      [server.id]
    );
    return { schedules };
  });

  fastify.post('/api/client/servers/:id/schedules', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'schedules')) return reply.code(403).send({ error: 'Missing permission: schedules' });
    const { name, cron, is_active, tasks } = req.body || {};
    if (!name || !cron) return reply.code(400).send({ error: 'name and cron are required' });
    const sched = await q1(
      `INSERT INTO schedules (server_id, name, cron, is_active) VALUES ($1,$2,$3,$4) RETURNING *`,
      [server.id, name, cron, is_active !== false]
    );
    for (const [i, t] of (tasks || []).entries()) {
      await q(
        `INSERT INTO schedule_tasks (schedule_id, sequence, action, payload) VALUES ($1,$2,$3,$4)`,
        [sched.id, i, t.action, t.payload || '']
      );
    }
    return reply.code(201).send({ schedule: sched });
  });

  fastify.patch('/api/client/schedules/:id', { preHandler: requireAuth }, async (req, reply) => {
    const sched = await q1(
      `SELECT s.*, sv.user_id AS owner_id FROM schedules s JOIN servers sv ON sv.id = s.server_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!sched) return reply.code(404).send({ error: 'Schedule not found' });
    if (!await canManage(req, reply, sched.server_id, 'schedules')) return;
    const { name, cron, is_active } = req.body || {};
    const updated = await q1(
      `UPDATE schedules SET name = COALESCE($1, name), cron = COALESCE($2, cron), is_active = COALESCE($3, is_active) WHERE id = $4 RETURNING *`,
      [name, cron, is_active, sched.id]
    );
    return { schedule: updated };
  });

  fastify.delete('/api/client/schedules/:id', { preHandler: requireAuth }, async (req, reply) => {
    const sched = await q1(
      `SELECT s.*, sv.user_id AS owner_id FROM schedules s JOIN servers sv ON sv.id = s.server_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!sched) return reply.code(404).send({ error: 'Schedule not found' });
    if (!await canManage(req, reply, sched.server_id, 'schedules')) return;
    await q(`DELETE FROM schedules WHERE id = $1`, [sched.id]);
    return { ok: true };
  });

  // Tasks
  fastify.post('/api/client/schedules/:id/tasks', { preHandler: requireAuth }, async (req, reply) => {
    const sched = await q1(
      `SELECT s.*, sv.user_id AS owner_id FROM schedules s JOIN servers sv ON sv.id = s.server_id WHERE s.id = $1`,
      [req.params.id]
    );
    if (!sched) return reply.code(404).send({ error: 'Schedule not found' });
    if (!await canManage(req, reply, sched.server_id, 'schedules')) return;
    const { action, payload } = req.body || {};
    if (!['start', 'stop', 'restart', 'kill', 'command'].includes(action)) return reply.code(400).send({ error: 'Invalid action' });
    const count = await q1(`SELECT count(*)::int AS c FROM schedule_tasks WHERE schedule_id = $1`, [sched.id]);
    const task = await q1(
      `INSERT INTO schedule_tasks (schedule_id, sequence, action, payload) VALUES ($1,$2,$3,$4) RETURNING *`,
      [sched.id, count.c, action, payload || '']
    );
    return reply.code(201).send({ task });
  });

  fastify.delete('/api/client/schedule-tasks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const task = await q1(
      `SELECT t.*, sv.user_id AS owner_id FROM schedule_tasks t JOIN schedules s ON s.id = t.schedule_id JOIN servers sv ON sv.id = s.server_id WHERE t.id = $1`,
      [req.params.id]
    );
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    if (!await canManage(req, reply, task.server_id, 'schedules')) return;
    await q(`DELETE FROM schedule_tasks WHERE id = $1`, [task.id]);
    return { ok: true };
  });
}
