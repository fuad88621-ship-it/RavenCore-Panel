import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import { q, q1 } from './db.js';
import { config } from './config.js';
import { requireAdmin } from './auth.js';

let pool = null;

async function dbPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.databaseServer.host,
      port: config.databaseServer.port,
      user: config.databaseServer.user,
      password: config.databaseServer.password,
      connectionLimit: 5,
    });
  }
  return pool;
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

export async function createDatabase(server, name) {
  const conn = await dbPool();
  const dbName = sanitizeName(name) || `srv_${server.identifier}`;
  const username = `u_${server.identifier}_${crypto.randomBytes(3).toString('hex')}`;
  const password = crypto.randomBytes(12).toString('hex');

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`CREATE USER IF NOT EXISTS '${username}'@'%' IDENTIFIED BY '${password}'`);
  await conn.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${username}'@'%'`);
  await conn.query('FLUSH PRIVILEGES');

  const record = await q1(
    `INSERT INTO server_databases (server_id, database_name, username, password, host)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    // Host is the public node FQDN so bot containers (on isolated networks)
    // can reach the database server.
    [server.id, dbName, username, password, config.node.fqdn]
  );
  return record;
}

export async function deleteDatabase(record) {
  const conn = await dbPool();
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${sanitizeName(record.database_name)}\``);
  } catch {}
  try {
    await conn.query(`DROP USER IF EXISTS '${sanitizeName(record.username)}'@'%'`);
  } catch {}
  await q(`DELETE FROM server_databases WHERE id = $1`, [record.id]);
  return { ok: true };
}

export async function rotateDatabasePassword(record) {
  const conn = await dbPool();
  const password = crypto.randomBytes(12).toString('hex');
  await conn.query(`ALTER USER '${sanitizeName(record.username)}'@'%' IDENTIFIED BY '${password}'`);
  await conn.query('FLUSH PRIVILEGES');
  const updated = await q1(`UPDATE server_databases SET password = $1 WHERE id = $2 RETURNING *`, [password, record.id]);
  return updated;
}

export async function databaseRoutes(fastify) {
  // Admin: list all databases
  fastify.get('/api/admin/databases', { preHandler: requireAdmin }, async () => {
    const databases = await q(
      `SELECT d.*, s.name AS server_name, s.identifier AS server_identifier, u.username AS owner_username
       FROM server_databases d
       JOIN servers s ON s.id = d.server_id
       JOIN users u ON u.id = s.user_id
       ORDER BY d.created_at DESC`
    );
    return { databases };
  });

  // Admin: create database for a server
  fastify.post('/api/admin/servers/:id/databases', { preHandler: requireAdmin }, async (req, reply) => {
    const server = await q1(`SELECT * FROM servers WHERE id = $1`, [req.params.id]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const count = await q1(`SELECT count(*)::int AS c FROM server_databases WHERE server_id = $1`, [server.id]);
    if (count.c >= server.databases) return reply.code(400).send({ error: `Server database limit reached (${server.databases})` });
    const db = await createDatabase(server, req.body?.name);
    return reply.code(201).send({ database: db });
  });

  // Admin: delete database
  fastify.delete('/api/admin/databases/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const record = await q1(`SELECT * FROM server_databases WHERE id = $1`, [req.params.id]);
    if (!record) return reply.code(404).send({ error: 'Database not found' });
    return deleteDatabase(record);
  });

  // Admin: rotate password
  fastify.post('/api/admin/databases/:id/rotate', { preHandler: requireAdmin }, async (req, reply) => {
    const record = await q1(`SELECT * FROM server_databases WHERE id = $1`, [req.params.id]);
    if (!record) return reply.code(404).send({ error: 'Database not found' });
    const updated = await rotateDatabasePassword(record);
    return { database: updated };
  });
}
