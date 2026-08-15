import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { q, q1, genUuid } from './db.js';
import { createSession, destroySession, getSessionUser } from './redis.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export async function registerUser(username, email, password) {
  if (!USERNAME_RE.test(username)) throw new Error('Username must be 3-32 chars (letters, numbers, . _ -)');
  if (!EMAIL_RE.test(email)) throw new Error('Invalid email address');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await q1(
      `INSERT INTO users (uuid, username, email, password_hash) VALUES ($1, $2, $3, $4)
       RETURNING id, uuid, username, email, root_admin, created_at`,
      [genUuid(), username, email.toLowerCase(), hash]
    );
    return user;
  } catch (e) {
    if (e.code === '23505') throw new Error('Username or email already registered');
    throw e;
  }
}

export async function loginUser(identifier, password) {
  const user = await q1(
    `SELECT * FROM users WHERE email = $1 OR username = $1`,
    [identifier.toLowerCase()]
  );
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return user;
}

export function publicUser(u) {
  return {
    id: u.id,
    uuid: u.uuid,
    username: u.username,
    email: u.email,
    root_admin: u.root_admin,
    language: u.language,
    suspended: u.suspended,
    created_at: u.created_at,
  };
}

export async function authRoutes(fastify) {
  fastify.get('/api/settings', async () => {
    const rows = await q(`SELECT key, value FROM settings ORDER BY key`);
    return { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });

  fastify.post('/api/auth/register', async (req, reply) => {
    const { username, email, password } = req.body || {};
    try {
      // Respect the panel.registration setting (Admin → Settings).
      const reg = await q1(`SELECT value FROM settings WHERE key = 'panel.registration'`);
      if (reg && reg.value === 'false') {
        return reply.code(403).send({ error: 'Registration is disabled' });
      }
      const user = await registerUser(username, email, password);
      const token = await createSession(user.id);
      reply.setCookie('raven_session', token, cookieOpts());
      return { user: publicUser(user) };
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Safe user search — only returns users matching an exact-ish email/username
  // query (min 3 chars), never dumps the whole user list.
  fastify.get('/api/users/search', { preHandler: requireAuth }, async (req, reply) => {
    const query = req.query.q;
    if (!query || query.trim().length < 3) return { users: [] };
    const users = await q(
      `SELECT id, username, email FROM users
       WHERE email ILIKE $1 OR username ILIKE $1
       LIMIT 8`,
      [`%${query.trim()}%`]
    );
    return { users };
  });

  // Log an action on a server (activity feed)
  fastify.post('/api/log/:serverId', { preHandler: requireAuth }, async (req, reply) => {
    const { action, metadata } = req.body || {};
    if (!action) return reply.code(400).send({ error: 'action required' });
    const server = await q1(`SELECT id FROM servers WHERE id = $1`, [req.params.serverId]);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    await q(
      `INSERT INTO activity_logs (server_id, user_id, action, metadata) VALUES ($1,$2,$3,$4)`,
      [server.id, req.user.id, action, JSON.stringify(metadata || {})]
    );
    return { ok: true };
  });

  fastify.post('/api/auth/login', async (req, reply) => {
    const { identifier, password } = req.body || {};
    const user = await loginUser(identifier, password);
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    if (user.suspended) return reply.code(403).send({ error: 'Account suspended' });
    const token = await createSession(user.id);
    reply.setCookie('raven_session', token, cookieOpts());
    return { user: publicUser(user) };
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req.cookies.raven_session);
    reply.clearCookie('raven_session', cookieOpts());
    return { ok: true };
  });

  fastify.get('/api/auth/me', async (req, reply) => {
    const user = await currentUser(req);
    if (!user) return reply.code(401).send({ error: 'Not logged in' });
    return { user: publicUser(user) };
  });
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  };
}

export async function currentUser(req) {
  const userId = await getSessionUser(req.cookies.raven_session);
  if (!userId) return null;
  return q1(`SELECT * FROM users WHERE id = $1`, [userId]);
}

export async function requireAuth(req, reply) {
  const user = await currentUser(req);
  if (!user) return reply.code(401).send({ error: 'Not logged in' });
  if (user.suspended) return reply.code(403).send({ error: 'Account suspended' });
  req.user = user;
  return null;
}

export async function requireAdmin(req, reply) {
  const err = await requireAuth(req, reply);
  if (err) return err;
  if (!req.user.root_admin) return reply.code(403).send({ error: 'Admin only' });
  return null;
}
