import { q, q1 } from './db.js';
import { requireAuth } from './auth.js';

const PERMISSIONS = ['console', 'files', 'databases', 'schedules', 'backups', 'settings', 'startup', 'network'];

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

// Subuser management (add/remove/edit users) is owner/admin only.
function isOwner(req, server) {
  return req.user.root_admin || server.user_id === req.user.id;
}

export async function subuserRoutes(fastify) {
  fastify.get('/api/client/servers/:id/users', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!isOwner(req, server)) return reply.code(403).send({ error: 'Only the owner can manage users' });
    const users = await q(
      `SELECT su.id, su.permissions, su.created_at, u.id AS user_id, u.username, u.email
       FROM server_subusers su JOIN users u ON u.id = su.user_id
       WHERE su.server_id = $1 ORDER BY su.created_at DESC`,
      [server.id]
    );
    return { users, permissions: PERMISSIONS };
  });

  fastify.post('/api/client/servers/:id/users', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    if (!isOwner(req, server)) return reply.code(403).send({ error: 'Only the owner can manage users' });
    const { user_id, permissions } = req.body || {};
    if (!user_id) return reply.code(400).send({ error: 'user_id required' });
    if (user_id === server.user_id) return reply.code(400).send({ error: 'The owner is already a user' });
    const user = await q1(`SELECT * FROM users WHERE id = $1`, [user_id]);
    if (!user) return reply.code(400).send({ error: 'User not found' });
    try {
      const su = await q1(
        `INSERT INTO server_subusers (server_id, user_id, permissions) VALUES ($1,$2,$3) RETURNING *`,
        [server.id, user_id, JSON.stringify(permissions || [])]
      );
      return reply.code(201).send({ subuser: su });
    } catch (e) {
      if (e.code === '23505') return reply.code(400).send({ error: 'User is already a sub-user' });
      throw e;
    }
  });

  fastify.patch('/api/client/subusers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const su = await q1(
      `SELECT su.*, sv.user_id AS owner_id FROM server_subusers su JOIN servers sv ON sv.id = su.server_id WHERE su.id = $1`,
      [req.params.id]
    );
    if (!su) return reply.code(404).send({ error: 'Sub-user not found' });
    if (!req.user.root_admin && su.owner_id !== req.user.id) return reply.code(403).send({ error: 'Only the owner can manage users' });
    const { permissions } = req.body || {};
    const updated = await q1(
      `UPDATE server_subusers SET permissions = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify(permissions || []), su.id]
    );
    return { subuser: updated };
  });

  fastify.delete('/api/client/subusers/:id', { preHandler: requireAuth }, async (req, reply) => {
    const su = await q1(
      `SELECT su.*, sv.user_id AS owner_id FROM server_subusers su JOIN servers sv ON sv.id = su.server_id WHERE su.id = $1`,
      [req.params.id]
    );
    if (!su) return reply.code(404).send({ error: 'Sub-user not found' });
    if (!req.user.root_admin && su.owner_id !== req.user.id) return reply.code(403).send({ error: 'Only the owner can manage users' });
    await q(`DELETE FROM server_subusers WHERE id = $1`, [su.id]);
    return { ok: true };
  });
}
