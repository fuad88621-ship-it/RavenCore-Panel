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
  res.json({ online: true, version: '0.2.0', features: ['transfer'] });
});

app.get('/host/stats', auth, async (req, res) => {
  try {
    res.json(await docker.getHostStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// The host's public IPv4 (used by the panel to auto-proxy game ports for
// remote nodes whose FQDN points back at the panel host).
app.get('/host/ip', auth, async (req, res) => {
  try {
    res.json({ ip: await docker.getHostIp() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// TCP proxy: forward a host port to a target (used to make game ports on
// remote nodes reachable through the panel host when the node's FQDN points
// at the panel). Runs as a socat container.
app.post('/proxy', auth, async (req, res) => {
  try {
    const { port, target } = req.body || {};
    if (!port || !target) return res.status(400).json({ error: 'port and target are required' });
    res.json(await docker.createProxy(port, target));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/proxy/:port', auth, async (req, res) => {
  try {
    res.json(await docker.removeProxy(req.params.port));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List active proxy containers (ports forwarded on this host).
app.get('/proxy', auth, async (req, res) => {
  try {
    res.json(await docker.listProxies());
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
    res.json(await docker.removeBot(req.params.uuid, !!(req.body && req.body.keep_files)));
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

// Transfer this server's files to another agent (panel-orchestrated).
// `url` + `token` are the destination agent's import endpoint and daemon token.
app.post('/servers/:uuid/transfer', async (req, res) => {
  try {
    const { url, token } = req.body || {};
    if (!url || !token) return res.status(400).json({ error: 'url and token are required' });
    res.json(await docker.transferOut(req.params.uuid, url, token));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Stream this server's files as a tar.gz (used by the panel to relay transfers
// between agents). Content-Length lets the panel show a real progress bar.
app.get('/servers/:uuid/transfer/download', async (req, res) => {
  try {
    const { path: tarPath, size } = await docker.createTransferArchive(req.params.uuid);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(size));
    const stream = fs.createReadStream(tarPath);
    const cleanup = () => fs.promises.rm(tarPath, { force: true }).catch(() => {});
    stream.on('close', cleanup);
    stream.on('error', cleanup);
    stream.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Receive a tar.gz stream of a transferred server's files.
app.post('/servers/:uuid/files/import', express.raw({ type: 'application/octet-stream', limit: '2gb' }), async (req, res) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'no data received' });
    }
    const dir = await docker.ensureBotDir(req.params.uuid);
    const tmp = path.join(dir, `.import-${Date.now()}.tar.gz`);
    await fs.promises.writeFile(tmp, req.body);
    try {
      await docker.importArchive(req.params.uuid, tmp);
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
    res.json({ ok: true });
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

wss.on('connection', (ws, req) => {
  handleConsole(ws, req).catch((e) => {
    console.error('[agent] ws handler error:', e.message);
    try { ws.close(1011, 'internal error'); } catch {}
  });
});

async function handleConsole(ws, req) {
  const url = new URL(req.url, 'http://localhost');
  const match = url.pathname.match(/^\/servers\/([^/]+)\/ws$/);
  if (!match) {
    try { ws.close(4000, 'bad path'); } catch {}
    return;
  }
  const uuid = match[1];
  if (!docker.UUID_RE.test(uuid)) {
    try { ws.close(4000, 'bad path'); } catch {}
    return;
  }
  const token = url.searchParams.get('token');
  try {
    const payload = jwt.verify(token, config.consoleSecret);
    if (payload.sub !== uuid || payload.scope !== 'console') throw new Error('token mismatch');
  } catch {
    try { ws.close(4001, 'invalid token'); } catch {}
    return;
  }

  console.log(`[agent] ws connect: ${uuid}`);
  let stream = null;
  let installTail = null;
  let pollTimer = null;
  try {
    // Only attach to the MAIN server container — never the one-off install
    // container (it shares the raven.uuid label and its raw multiplexed
    // stream would show binary garbage).
    const main = await docker.findMainContainer(uuid);
    if (!main) throw new Error('container not found');
    const info = await main.inspect();
    if (!info.State.Running) throw new Error('container not running');
    stream = await docker.attachConsole(uuid, (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
    }, () => {
      if (ws.readyState === ws.OPEN) ws.close(1000, 'container stopped');
    });
    console.log(`[agent] ws attached: ${uuid}`);
  } catch (e) {
    // Distinguish "installing" (no container yet) from "stopped" (container
    // exists but not running). A stopped server shouldn't show the install log.
    let stopped = false;
    try {
      const c = await docker.findMainContainer(uuid);
      if (c) {
        const info = await c.inspect();
        stopped = !info.State.Running;
      }
    } catch {}
    if (stopped) {
      if (ws.readyState === ws.OPEN) ws.send('\x1b[33m● Server is offline. It will appear here when started.\x1b[0m\n');
      pollTimer = setInterval(async () => {
        try {
          const c = await docker.findMainContainer(uuid);
          if (c) {
            const info = await c.inspect();
            if (info.State.Running) {
              clearInterval(pollTimer);
              pollTimer = null;
              try {
                stream = await docker.attachConsole(uuid, (chunk) => {
                  if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
                }, () => {
                  if (ws.readyState === ws.OPEN) ws.close(1000, 'container stopped');
                });
                console.log(`[agent] ws switched to live console: ${uuid}`);
              } catch {}
            }
          }
        } catch {}
      }, 2000);
      return;
    }
    // Main container not running yet (e.g. installing) — stream the install
    // log instead, then switch to the live console once the container starts.
    console.log(`[agent] ws attach failed (${e.message}) — streaming install log`);
    try {
      installTail = await docker.streamInstallLog(uuid, (chunk) => {
        if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
      }, () => {});
      pollTimer = setInterval(async () => {
        try {
          const c = await docker.findMainContainer(uuid);
          if (c) {
            const info = await c.inspect();
            if (info.State.Running) {
              clearInterval(pollTimer);
              pollTimer = null;
              installTail.stop();
              installTail = null;
              try {
                stream = await docker.attachConsole(uuid, (chunk) => {
                  if (ws.readyState === ws.OPEN) ws.send(chunk.toString('utf8'));
                }, () => {
                  if (ws.readyState === ws.OPEN) ws.close(1000, 'container stopped');
                });
                console.log(`[agent] ws switched to live console: ${uuid}`);
              } catch {}
            }
          }
        } catch {}
      }, 2000);
    } catch (e2) {
      console.log(`[agent] no install log either: ${e2.message}`);
      try { ws.close(4002, 'server not running'); } catch {}
      return;
    }
  }

  ws.on('message', (data) => {
    if (stream && stream.writable) stream.write(data);
  });

  ws.on('close', () => {
    console.log(`[agent] ws closed: ${uuid}`);
    if (pollTimer) clearInterval(pollTimer);
    try { installTail?.stop(); } catch {}
    try { stream?.end(); } catch {}
  });
}

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
const EC_KEY_PATH = path.join(config.botDataDir, '..', 'sftp_host_key_ecdsa.pem');
const hostKeys = [];
// Legacy RSA key (if present) — kept for older clients.
try { hostKeys.push(fs.readFileSync(HOST_KEY_PATH)); } catch {}
// ECDSA P-256 key — modern clients (OpenSSH 8.8+) reject ssh-rsa by default,
// so this is the primary host key. ssh2-streams only parses SEC1/PKCS1 PEM,
// so export as SEC1 (ed25519/EC PKCS8 are not supported by the library).
let ecKey;
try {
  ecKey = fs.readFileSync(EC_KEY_PATH);
} catch {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  ecKey = privateKey.export({ type: 'sec1', format: 'pem' });
  fs.mkdirSync(path.dirname(EC_KEY_PATH), { recursive: true });
  fs.writeFileSync(EC_KEY_PATH, ecKey);
}
hostKeys.push(ecKey);

const sftpServer = new SSHServer({ hostKeys }, (client) => {
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

sftpServer.listen(config.sftpPort, '0.0.0.0', () => {
  console.log(`[agent] sftp listening on :${config.sftpPort}`);
});
