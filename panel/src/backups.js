import { q, q1, genUuid } from './db.js';
import { requireAuth } from './auth.js';
import { agentRequest, agentRequestFor } from './agent-client.js';

async function getServerForUser(req, reply) {
  const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
  if (!server) { reply.code(404).send({ error: 'Server not found' }); return null; }
  if (!req.user.root_admin && server.user_id !== req.user.id) {
    reply.code(403).send({ error: 'Not your server' });
    return null;
  }
  return server;
}

export async function backupRoutes(fastify) {
  fastify.get('/api/client/servers/:id/backups', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const backups = await q(`SELECT * FROM backups WHERE server_id = $1 ORDER BY created_at DESC`, [server.id]);
    return { backups };
  });

  fastify.post('/api/client/servers/:id/backups', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
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
      `SELECT b.*, s.uuid AS server_uuid FROM backups b JOIN servers s ON s.id = b.server_id WHERE b.id = $1 AND (s.user_id = $2 OR $3)`,
      [req.params.id, req.user.id, req.user.root_admin]
    );
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });
    const url = `${process.env.AGENT_INTERNAL_URL || 'http://agent:8080'}/servers/${backup.server_uuid}/backups/${backup.uuid}/download`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AGENT_TOKEN}` } });
    if (!res.ok) return reply.code(500).send({ error: 'Backup file not found on node' });
    const buf = Buffer.from(await res.arrayBuffer());
    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Disposition', `attachment; filename="${backup.name}.tar.gz"`);
    return reply.send(buf);
  });

  fastify.post('/api/client/backups/:id/restore', { preHandler: requireAuth }, async (req, reply) => {
    const backup = await q1(
      `SELECT b.*, s.uuid AS server_uuid FROM backups b JOIN servers s ON s.id = b.server_id WHERE b.id = $1 AND (s.user_id = $2 OR $3)`,
      [req.params.id, req.user.id, req.user.root_admin]
    );
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });
    await agentRequestFor(backup.server_uuid, `/servers/${backup.server_uuid}/backups/${backup.uuid}/restore`, 'POST');
    return { ok: true };
  });

  fastify.delete('/api/client/backups/:id', { preHandler: requireAuth }, async (req, reply) => {
    const backup = await q1(
      `SELECT b.*, s.uuid AS server_uuid FROM backups b JOIN servers s ON s.id = b.server_id WHERE b.id = $1 AND (s.user_id = $2 OR $3)`,
      [req.params.id, req.user.id, req.user.root_admin]
    );
    if (!backup) return reply.code(404).send({ error: 'Backup not found' });
    try {
      await agentRequestFor(backup.server_uuid, `/servers/${backup.server_uuid}/backups/${backup.uuid}`, 'DELETE');
    } catch {}
    await q(`DELETE FROM backups WHERE id = $1`, [backup.id]);
    return { ok: true };
  });
}
