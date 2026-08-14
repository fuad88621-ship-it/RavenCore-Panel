import crypto from 'node:crypto';
import { q, q1 } from './db.js';

// Pterodactyl-style application API keys: ptla_<random>
export const KEY_PREFIX = 'ptla_';

export function generateKey() {
  return KEY_PREFIX + crypto.randomBytes(24).toString('hex');
}

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function createApiKey(userId, description, permissions) {
  const key = generateKey();
  const prefix = key.slice(0, 12);
  await q(
    `INSERT INTO api_keys (user_id, key_prefix, key_hash, description, permissions)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, prefix, hashKey(key), description || '', JSON.stringify(permissions || [])]
  );
  return { key, prefix };
}

export async function listApiKeys(userId) {
  return q(
    `SELECT id, key_prefix, description, permissions, last_used_at, created_at
     FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
}

export async function deleteApiKey(userId, id) {
  await q(`DELETE FROM api_keys WHERE id = $1 AND user_id = $2`, [id, userId]);
  return { ok: true };
}

// Authenticate a request using an application API key.
// Returns the key record + owner user, or null.
export async function authApiKey(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !token.startsWith(KEY_PREFIX)) return null;
  const hash = hashKey(token);
  const key = await q1(
    `SELECT k.*, u.id AS user_id, u.root_admin, u.suspended
     FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = $1`,
    [hash]
  );
  if (!key || key.suspended) return null;
  await q(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]);
  return key;
}

export function hasPermission(key, perm) {
  const perms = key.permissions || [];
  return perms.includes('*') || perms.includes(perm);
}

export async function requireApiKey(req, reply) {
  const key = await authApiKey(req);
  if (!key) return reply.code(401).send({ error: 'Invalid API key' });
  req.apiKey = key;
  return null;
}
