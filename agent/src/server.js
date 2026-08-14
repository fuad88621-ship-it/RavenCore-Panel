import express from 'express';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import * as docker from './docker.js';
import * as backup from './backup.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Auth middleware: shared secret between panel and agent
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== config.agentToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Strict UUID validation on every server route — prevents path traversal
// via a crafted :uuid (e.g. ../../etc).
app.param('uuid', (req, res, next, uuid) => {
  if (!docker.UUID_RE.test(uuid)) {
    return res.status(400).json({ error: 'Invalid server id' });
  }
  next();
});

app.use('/servers', auth);

app.get('/health', (req, res) => {
  res.json({ online: true, version: '0.2.0' });
});

app.get('/host/stats', auth, async (req, res) => {
  try {
    res.json(await docker.getHostStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers', async (req, res) => {
  try {
    const result = await docker.createBot(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/servers/:uuid', async (req, res) => {
  try {
    res.json(await docker.removeBot(req.params.uuid));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/power', async (req, res) => {
  try {
    res.json(await docker.power(req.params.uuid, req.body.action));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/command', async (req, res) => {
  try {
    res.json(await docker.sendCommand(req.params.uuid, req.body.command));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/servers/:uuid/files', async (req, res) => {
  try {
    res.json(await docker.listFiles(req.params.uuid, req.query.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/read', async (req, res) => {
  try {
    res.json(await docker.readFile(req.params.uuid, req.body.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/write', async (req, res) => {
  try {
    res.json(await docker.writeFile(req.params.uuid, req.body.path, req.body.content, req.body.encoding));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/delete', async (req, res) => {
  try {
    res.json(await docker.deleteFile(req.params.uuid, req.body.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/rename', async (req, res) => {
  try {
    res.json(await docker.renameFile(req.params.uuid, req.body.path, req.body.newPath));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/archive', async (req, res) => {
  try {
    res.json(await docker.archiveFiles(req.params.uuid, req.body.paths, req.body.archiveName));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/extract', async (req, res) => {
  try {
    res.json(await docker.extractArchive(req.params.uuid, req.body.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/files/mkdir', async (req, res) => {
  try {
    res.json(await docker.createFolder(req.params.uuid, req.body.path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Plugins ----

app.get('/servers/:uuid/plugins', async (req, res) => {
  try {
    res.json(await docker.listPlugins(req.params.uuid));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/plugins/install', async (req, res) => {
  try {
    res.status(201).json(await docker.installPlugin(req.params.uuid, req.body.url, req.body.filename));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/servers/:uuid/plugins/:filename', async (req, res) => {
  try {
    res.json(await docker.deletePlugin(req.params.uuid, req.params.filename));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/servers/:uuid/files/download', async (req, res) => {
  try {
    const target = docker.downloadFilePath(req.params.uuid, req.query.path);
    res.download(target);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update spec (env vars, startup command, limits) and rebuild the container
// so changes actually apply.
app.patch('/servers/:uuid/spec', async (req, res) => {
  try {
    const { env, startup_command, image, memory_mb, cpu, disk_mb, mounts, allocation_port } = req.body || {};
    const patch = {};
    if (env !== undefined) patch.env = env;
    if (startup_command !== undefined) patch.startup_command = startup_command;
    if (image !== undefined) patch.image = image;
    if (memory_mb !== undefined) patch.memory_mb = memory_mb;
    if (cpu !== undefined) patch.cpu = cpu;
    if (disk_mb !== undefined) patch.disk_mb = disk_mb;
    if (mounts !== undefined) patch.mounts = mounts;
    if (allocation_port !== undefined) patch.allocation_port = allocation_port;
    await docker.updateSpec(req.params.uuid, patch);
    await docker.recreateContainer(req.params.uuid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/servers/:uuid/resources', async (req, res) => {
  try {
    res.json(await docker.getResources(req.params.uuid));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/servers/:uuid/install-log', async (req, res) => {
  try {
    const log = await docker.getInstallLog(req.params.uuid);
    res.json({ log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/reinstall', async (req, res) => {
  try {
    const { image, install_command } = req.body;
    const spec = await docker.getContainerInfo(req.params.uuid);
    const container = await docker.findContainer(req.params.uuid);
    if (container) {
      try { await container.kill(); } catch {}
      await container.remove({ force: true });
    }
    await docker.createBot({
      ...spec,
      image: image || spec.image,
      install_command: install_command || spec.install_command,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Backups ----

app.post('/servers/:uuid/backups', async (req, res) => {
  try {
    res.status(201).json(await docker.createBackup(req.params.uuid, req.body.name));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/servers/:uuid/backups/:name/download', async (req, res) => {
  try {
    const p = await docker.getBackupPath(req.params.name);
    res.download(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/servers/:uuid/backups/:name/restore', async (req, res) => {
  try {
    res.json(await docker.restoreBackup(req.params.uuid, req.params.name));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/servers/:uuid/backups/:name', async (req, res) => {
  try {
    res.json(await docker.deleteBackup(req.params.name));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- SFTP password sync ----

app.post('/servers/:uuid/sftp', async (req, res) => {
  try {
    res.json(await docker.setSftpPassword(req.params.uuid, req.body.password));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Full-panel backup ----
app.post('/backup', auth, async (req, res) => {
  try {
    const result = await backup.createBackup();
    res.json(result);
  } catch (e) {
    console.error('[agent] backup failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/backup', auth, async (req, res) => {
  try {
    res.json({ backups: backup.listBackups() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/backup/download/:name', auth, async (req, res) => {
  try {
    const p = backup.getBackupPath(req.params.name);
    res.download(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[agent] listening on :${config.port}`);
});

// Crash detection + auto-restart with backoff, and bring back servers that
// were running before this agent restarted.
docker.startCrashMonitor();
docker.restoreRunningContainers().then(() => console.log('[agent] containers restored'));

// ---- Console WebSocket ----
// Path is validated manually in the connection handler (the ws library's
// `path` option is a literal match, not a pattern).
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const match = url.pathname.match(/^\/servers\/([^/]+)\/ws$/);
  if (!match) {
    ws.close(4000, 'bad path');
    return;
  }
  const uuid = match[1];
  if (!docker.UUID_RE.test(uuid)) {
    ws.close(4000, 'bad path');
    return;
  }
  const token = url.searchParams.get('token');
  try {
    const payload = jwt.verify(token, config.consoleSecret);
    if (payload.sub !== uuid || payload.scope !== 'console') throw new Error('token mismatch');
  } catch {
    ws.close(4001, 'invalid token');
    return;
  }

  console.log(`[agent] ws connect: ${uuid}`);
  let stream = null;
  try {
    stream = await docker.attachConsole(uuid, (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
    }, () => {
      if (ws.readyState === ws.OPEN) ws.close(1000, 'container stopped');
    });
    console.log(`[agent] ws attached: ${uuid}`);
  } catch (e) {
    console.log(`[agent] ws attach failed: ${uuid}: ${e.message}`);
    ws.close(4002, e.message);
    return;
  }

  ws.on('message', (data) => {
    if (stream && stream.writable) stream.write(data);
  });

  ws.on('close', () => {
    console.log(`[agent] ws closed: ${uuid}`);
    try { stream?.end(); } catch {}
  });
});

console.log('[agent] console websocket ready');

// ---- SFTP server ----
// Users connect with username = server identifier, password = server's
// SFTP password (shown in the panel's Network tab). Each user is chrooted
// to their server's data directory.
import ssh2Pkg from 'ssh2';
import SFTPServer from 'ssh2-sftp-server';
const { Server: SSHServer } = ssh2Pkg;
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HOST_KEY_PATH = path.join(config.botDataDir, '..', 'sftp_host_key.pem');
let hostKey;
try {
  hostKey = fs.readFileSync(HOST_KEY_PATH);
} catch {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' });
  fs.mkdirSync(path.dirname(HOST_KEY_PATH), { recursive: true });
  fs.writeFileSync(HOST_KEY_PATH, hostKey);
}

const sftpServer = new SSHServer({ hostKeys: [hostKey] }, (client) => {
  let sftpInfo = null;

  client.on('authentication', (ctx) => {
    if (ctx.method !== 'password') return ctx.reject();
    docker.getSftpInfo(ctx.username).then((info) => {
      if (info && info.sftp_password && info.sftp_password === ctx.password) {
        sftpInfo = info;
        ctx.accept();
      } else {
        ctx.reject();
      }
    }).catch(() => ctx.reject());
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('sftp', (accept2) => {
        const sftpStream = accept2();
        if (!sftpInfo) {
          console.log('[agent] sftp: no info for session');
          sftpStream.close();
          return;
        }
        try {
          new SFTPServer(sftpStream, { root: sftpInfo.dir });
          console.log('[agent] sftp session for', sftpInfo.uuid);
        } catch (e) {
          console.log('[agent] sftp init failed:', e.message);
          sftpStream.close();
        }
      });
    });
  });

  client.on('error', () => {});
});

sftpServer.listen(2022, '0.0.0.0', () => {
  console.log('[agent] sftp listening on :2022');
});
