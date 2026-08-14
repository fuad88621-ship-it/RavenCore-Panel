import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import path from 'path';
import { config } from './config.js';
import { initDb } from './db.js';
import { initRedis } from './redis.js';
import { authRoutes } from './auth.js';
import { adminRoutes } from './admin.js';
import { adminServerRoutes } from './admin-servers.js';
import { adminNestRoutes } from './admin-nests.js';
import { databaseRoutes } from './admin-databases.js';
import { clientRoutes } from './client.js';
import { applicationRoutes } from './application.js';
import { scheduleRoutes, startScheduler } from './schedules.js';
import { subuserRoutes } from './subusers.js';
import { backupRoutes } from './backups.js';
import { networkRoutes } from './network.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cookie);
await app.register(rateLimit, {
  global: false,
  max: config.security.rate_limit,
  timeWindow: '1 minute',
});
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
  wildcard: false,
});

await initDb();
await initRedis();

await app.register(authRoutes);
await app.register(adminRoutes);
await app.register(adminServerRoutes);
await app.register(adminNestRoutes);
await app.register(databaseRoutes);
await app.register(clientRoutes);
await app.register(applicationRoutes);
await app.register(scheduleRoutes);
await app.register(subuserRoutes);
await app.register(backupRoutes);
await app.register(networkRoutes);

startScheduler();

// SPA fallback
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Not found' });
  }
  return reply.sendFile('index.html');
});

// Graceful shutdown — never lose data
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received, shutting down gracefully…`);
  try {
    await app.close();
    const { pool } = await import('./db.js');
    await pool.end();
    process.exit(0);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen({ port: config.panel.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`[panel] ${config.app.name} listening on :${config.panel.port}`);
});
