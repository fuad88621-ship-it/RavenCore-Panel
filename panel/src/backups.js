import { q, q1, genUuid } from './db.js';
import { Readable } from 'node:stream';
import { requireAuth } from './auth.js';
import { agentRequest, agentRequestFor } from './agent-client.js';

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

async function canManage(req, reply, serverId, perm) {
  if (req.user.root_admin) return true;
  const owner = await q1(`SELECT user_id FROM servers WHERE id = $1`, [serverId]);
  if (owner && owner.user_id === req.user.id) return true;
  const su = await q1(`SELECT permissions FROM server_subusers WHERE server_id = $1 AND user_id = $2`, [serverId, req.user.id]);
  if (su && (su.permissions || []).includes(perm)) return true;
  reply.code(403).send({ error: `Missing permission: ${perm}` });
  return false;
}

export async function backupRoutes(fastify) {
  fastify.get('/api/client/servers/:id/backups', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'backups')) return reply.code(403).send({ error: 'Missing permission: backups' });
    const backups = await q(`SELECT * FROM backups WHERE server_id = $1 ORDER BY created_at DESC`, [server.id]);
    return { backups };
  });

  fastify.post('/api/client/servers/:id/backups', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!can(server, 'backups')) return reply.code(403).send({ error: 'Missing permission: backups' });
    const count = await q1(`SELECT count(*)::int AS c FROM backups WHERE server_id = $1`, [server.id]);
    if (count.c >= server.backups) return reply.code(400).send({ error: `Backup limit reached (${server.backups})` });
    const name = req.body?.name || `backup-${Date.now()}`;
    const uuid = genUuid();
    const backup = await q1(
      `INSERT INTO backups (uuid, server_id, name, status) VALUES ($1,$2,$3,'running') RETURNING *`,
      [uuid, server.id, name]
    );
    agentRequestFor(server.uuid, `/servers/${server.uuid}/backups`, 'POST', { name: uuid }).then(async (res) => {
      await q(`UPDATE backups SET size_bytes = $1, status = 'completed' WHERE id = $2`, [res.size_bytes || 0, backup.id]);
    }).catch(async (e) => {
      console.error('[backups] create failed:', e.message);
      await q(`UPDATE backups SET status = 'failed' WHERE id = $1`, [backup.id]);
    });
    return reply.code(201).send({ backup });
  });

  fastify.get('/api/client/backups/:id/download', { preHandler: requireAuth }, async (req, reply) => {
    const backup = await q1(
      `SELECT b.*, s.uuid AS server_uuid, s.id AS server_id FROM backups b JOIN servers s ON s.id = b.server_id WHERE b.id = $1`,
      [req.params.id]
    );
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });
    if (!await canManage(req, reply, backup.server_id, 'backups')) return;
    // Route to the node that actually hosts the server — the old code always
    // hit the LOCAL agent, so backups on remote nodes 404'd.
    try {
      const agentRes = await agentRequestFor(backup.server_uuid, `/servers/${backup.server_uuid}/backups/${backup.uuid}/download`, 'GET', undefined, { raw: true });
      reply.header('Content-Type', 'application/gzip');
      reply.header('Content-Disposition', `attachment; filename="${backup.name}.tar.gz"`);
      // fetch() gives a WHATWG ReadableStream — Fastify can't stream that
      // directly (it would send an empty body). Convert to a Node stream.
      return Readable.fromWeb(agentRes.body);
    } catch (e) {
      return reply.code(500).send({ error: 'Backup file not found on node' });
    }
  });

  fastify.post('/api/client/backups/:id/restore', { preHandler: requireAuth }, async (req, reply) => {
    const backup = await q1(
      `SELECT b.*, s.uuid AS server_uuid, s.id AS server_id FROM backups b JOIN servers s ON s.id = b.server_id WHERE b.id = $1`,
      [req.params.id]
    );
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });
    if (!await canManage(req, reply, backup.server_id, 'backups')) return;
    await agentRequestFor(backup.server_uuid, `/servers/${backup.server_uuid}/backups/${backup.uuid}/restore`, 'POST');
    return { ok: true };
  });

  fastify.delete('/api/client/backups/:id', { preHandler: requireAuth }, async (req, reply) => {
    const backup = await q1(
      `SELECT b.*, s.uuid AS server_uuid, s.id AS server_id FROM backups b JOIN servers s ON s.id = b.server_id WHERE b.id = $1`,
      [req.params.id]
    );
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });
    if (!await canManage(req, reply, backup.server_id, 'backups')) return;
    try {
      await agentRequestFor(backup.server_uuid, `/servers/${backup.server_uuid}/backups/${backup.uuid}`, 'DELETE');
    } catch {}
    await q(`DELETE FROM backups WHERE id = $1`, [backup.id]);
    return { ok: true };
  });
}
