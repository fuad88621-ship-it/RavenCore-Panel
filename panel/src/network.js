import { q, q1 } from './db.js';
import { requireAuth } from './auth.js';
import crypto from 'node:crypto';

async function getServerForUser(req, reply) {
  const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
  if (!server) { reply.code(404).send({ error: 'Server not found' }); return null; }
  if (!req.user.root_admin && server.user_id !== req.user.id) {
    reply.code(403).send({ error: 'Not your server' });
    return null;
  }
  return server;
}

export async function networkRoutes(fastify) {
  // List allocations for a server
  fastify.get('/api/client/servers/:id/network', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const allocations = await q(
      `SELECT a.*, n.name AS node_name FROM allocations a JOIN nodes n ON n.id = a.node_id
       WHERE a.server_id = $1 ORDER BY a.port`,
      [server.id]
    );
    return { allocations };
  });

  // SFTP credentials
  fastify.get('/api/client/servers/:id/sftp', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    let pw = server.sftp_password;
    if (!pw) {
      pw = crypto.randomBytes(12).toString('hex');
      await q(`UPDATE servers SET sftp_password = $1 WHERE id = $2`, [pw, server.id]);
    }
    // Always sync to the agent so the SFTP server accepts it
    try {
      const { agentRequest, agentRequestFor } = await import('./agent-client.js');
      await agentRequestFor(server.uuid, `/servers/${server.uuid}/sftp`, 'POST', { password: pw });
    } catch (e) {
      console.error('[network] sftp sync failed:', e.message);
    }
    const node = await q1(`SELECT fqdn FROM nodes WHERE id = $1`, [server.node_id]);
    return {
      host: node.fqdn,
      port: 2022,
      username: server.identifier,
      password: pw,
    };
  });

  fastify.post('/api/client/servers/:id/sftp/password', { preHandler: requireAuth }, async (req, reply) => {
    const server = await getServerForUser(req, reply);
    if (!server) return;
    const pw = crypto.randomBytes(12).toString('hex');
    await q(`UPDATE servers SET sftp_password = $1 WHERE id = $2`, [pw, server.id]);
    // Sync to the agent so the SFTP server accepts the new password
    try {
      const { agentRequest, agentRequestFor } = await import('./agent-client.js');
      await agentRequestFor(server.uuid, `/servers/${server.uuid}/sftp`, 'POST', { password: pw });
    } catch (e) {
      console.error('[network] sftp sync failed:', e.message);
    }
    return { password: pw };
  });
}
