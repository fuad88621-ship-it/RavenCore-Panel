import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const exec = promisify(execFile);

const docker = new Docker();

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function botDir(uuid) {
  return path.join(config.botDataDir, uuid);
}

export async function ensureBotDir(uuid) {
  const dir = botDir(uuid);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function containerName(identifier) {
  return `raven-${identifier}`;
}

// Strip Docker multiplexed stream framing so logs are readable text.
function stripDockerStream(chunk) {
  if (!Buffer.isBuffer(chunk) || chunk.length < 8) return chunk.toString('utf8');
  let out = '';
  let i = 0;
  while (i + 8 <= chunk.length) {
    const size = chunk.readUInt32BE(i + 4);
    if (size <= 0 || i + 8 + size > chunk.length) break;
    out += chunk.slice(i + 8, i + 8 + size).toString('utf8');
    i += 8 + size;
  }
  // Fallback: if no frames parsed, return whole chunk
  return out || chunk.toString('utf8');
}

function networkName(identifier) {
  return `raven-${identifier}-net`;
}

// Each bot gets its own isolated bridge network: it can reach the internet
// (Discord API) but CANNOT reach any other bot's container.
async function ensureNetwork(identifier) {
  const name = networkName(identifier);
  try {
    const net = docker.getNetwork(name);
    await net.inspect();
    return net;
  } catch {
    return docker.createNetwork({ Name: name, Driver: 'bridge', Internal: false });
  }
}

export async function findContainer(uuid) {
  const containers = await docker.listContainers({ all: true });
  const hit = containers.find((c) => c.Labels && c.Labels['raven.uuid'] === uuid);
  if (hit) return docker.getContainer(hit.Id);
  return null;
}

export async function createBot({ uuid, identifier, image, startup_command, install_command, memory_mb, disk_mb, cpu, env, mounts = [], mount_target = '/home/container', sftp_password = null, io = 500, cpu_pinning = '', oom_killer = true }) {
  const dir = await ensureBotDir(uuid);
  const name = containerName(identifier);
  const net = await ensureNetwork(identifier);

  // Remove any stale container with the same name
  try {
    const stale = await docker.getContainer(name);
    await stale.remove({ force: true });
  } catch {}

  // Pull image
  await pullImage(image);

  // Install step: run install command in a one-off container and capture logs
  if (install_command) {
    console.log(`[agent] installing ${identifier}: ${install_command.slice(0, 80)}…`);
    const installContainer = await docker.createContainer({
      Image: image,
      name: `${name}-install`,
      WorkingDir: mount_target,
      HostConfig: {
        Binds: [`${dir}:${mount_target}`],
        NetworkMode: net.id,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
      },
      Cmd: ['sh', '-c', install_command],
      AttachStdout: true,
      AttachStderr: true,
      Labels: { 'raven.uuid': uuid, 'raven.install': 'true' },
    });
    const logPath = path.join(dir, 'install.log');
    const logHandle = await fs.open(logPath, 'w');
    const installStream = await installContainer.attach({ stream: true, stdout: true, stderr: true });
    installStream.on('data', (chunk) => {
      logHandle.write(stripDockerStream(chunk));
    });
    await installContainer.start();
    await installContainer.wait();
    installStream.end();
    await logHandle.close();
    await installContainer.remove({ force: true });
  }

  // Persist the bot spec so reinstall / start can rebuild it
  await fs.writeFile(path.join(dir, 'spec.json'), JSON.stringify({
    uuid, identifier, image, startup_command, install_command, memory_mb, disk_mb, cpu, env, mounts, mount_target, io,
    sftp_password: sftp_password || null,
  }), 'utf8');

  // Build bind mounts: bot data dir + any admin-configured mounts
  const binds = [`${dir}:${mount_target}`];
  for (const m of mounts || []) {
    binds.push(`${m.source}:${m.target}${m.read_only ? ':ro' : ''}`);
  }

  // Create the real container
  const container = await docker.createContainer({
    Image: image,
    name,
    User: 'root',
    WorkingDir: mount_target,
    Tty: true,
    OpenStdin: true,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Env: Object.entries(env || {}).map(([k, v]) => `${k}=${v}`),
    HostConfig: {
      Memory: memory_mb * 1024 * 1024,
      // Cap swap at 2x memory so a runaway bot can't thrash the host
      MemorySwap: memory_mb * 2 * 1024 * 1024,
      NanoCpus: Math.round((cpu / 100) * 1e9),
      // CPU pinning (e.g. "0,1" or "0-1,3")
      CpusetCpus: cpu_pinning || undefined,
      // OOM killer: terminates the container if it breaches memory
      OomKillDisable: !oom_killer,
      // IO weight (100-1000, default 500)
      BlkioWeight: Math.min(1000, Math.max(100, io || 500)),
      // Prevent fork bombs / runaway processes (generous — normal apps
      // use 5-50; this only stops a single user from spawning unlimited)
      PidsLimit: 1024,
      Binds: binds,
      RestartPolicy: { Name: 'unless-stopped' },
      NetworkMode: net.id,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
      // Raise file-descriptor limits so bots can handle many concurrent
      // connections (Discord bots with large guild counts need this).
      Ulimits: [
        { Name: 'nofile', Soft: 65536, Hard: 65536 },
        { Name: 'nproc', Soft: 1024, Hard: 1024 },
      ],
      // Rotate container logs so they can't fill the disk
      LogConfig: { Type: 'json-file', Config: { 'max-size': '5m', 'max-file': '1' } },
    },
    Cmd: ['bash', '-c', startup_command],
    Labels: { 'raven.uuid': uuid, 'raven.identifier': identifier },
  });

  return { container_id: container.id };
}

export async function pullImage(image) {
  const stream = await docker.pull(image);
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()), () => {});
  });
}

export async function power(uuid, action) {
  switch (action) {
    case 'start': {
      let container = await findContainer(uuid);
      if (!container) {
        // Container was removed (e.g. after env change) — rebuild from spec
        const spec = await getContainerInfo(uuid);
        await createBot(spec);
        container = await findContainer(uuid);
      }
      await container.start();
      break;
    }
    case 'stop': {
      const container = await findContainer(uuid);
      if (!container) return { status: 'offline' };
      await container.stop({ t: 10 });
      break;
    }
    case 'restart': {
      const container = await findContainer(uuid);
      if (!container) return { status: 'offline' };
      await container.restart({ t: 10 });
      break;
    }
    case 'kill': {
      const container = await findContainer(uuid);
      if (!container) return { status: 'offline' };
      await container.kill();
      break;
    }
    default: throw new Error('Invalid action');
  }
  const container = await findContainer(uuid);
  const info = container ? await container.inspect() : null;
  return { status: info?.State.Running ? 'running' : 'offline' };
}

export async function removeBot(uuid) {
  const container = await findContainer(uuid);
  if (container) {
    try { await container.kill(); } catch {}
    await container.remove({ force: true });
  }
  // Remove the bot's isolated network
  try {
    const net = docker.getNetwork(networkName((await getContainerInfo(uuid)).identifier));
    await net.remove();
  } catch {}
  await fs.rm(botDir(uuid), { recursive: true, force: true });
  return { ok: true };
}

export async function sendCommand(uuid, command) {
  const container = await findContainer(uuid);
  if (!container) throw new Error('Container not found');
  const exec = await container.exec({
    Cmd: ['sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
    AttachStdin: false,
  });
  const stream = await exec.start();
  await new Promise((resolve) => {
    stream.on('end', resolve);
    stream.resume();
  });
  return { ok: true };
}

export async function getResources(uuid) {
  const container = await findContainer(uuid);
  if (!container) return { running: false, cpu: 0, memory_mb: 0, memory_limit_mb: 0, disk_mb: 0, disk_limit_mb: 0, network_rx_mb: 0, network_tx_mb: 0, uptime_seconds: 0 };
  const info = await container.inspect();
  const running = info.State.Running;
  let cpuPct = 0, memoryMb = 0, memoryLimitMb = 0, diskMb = 0, diskLimitMb = 0, netRxMb = 0, netTxMb = 0, uptimeSeconds = 0;

  if (running) {
    try {
      const stats = await container.stats({ stream: false });
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
      const sysDelta = (stats.cpu_stats.system_cpu_usage || 0) - (stats.precpu_stats.system_cpu_usage || 0);
      const onlineCpus = stats.cpu_stats.online_cpus || 1;
      cpuPct = sysDelta > 0 ? (cpuDelta / sysDelta) * onlineCpus * 100 : 0;
      memoryMb = stats.memory_stats.usage ? Math.round(stats.memory_stats.usage / 1024 / 1024) : 0;
      memoryLimitMb = stats.memory_stats.limit ? Math.round(stats.memory_stats.limit / 1024 / 1024) : 0;
      const net = stats.networks ? Object.values(stats.networks)[0] : null;
      if (net) {
        netRxMb = Math.round((net.rx_bytes || 0) / 1024 / 1024 * 100) / 100;
        netTxMb = Math.round((net.tx_bytes || 0) / 1024 / 1024 * 100) / 100;
      }
    } catch (e) {
      console.error('[agent] stats error:', e.message);
    }
  }

  // Disk usage from the server's bind-mounted data directory
  try {
    const dir = botDir(uuid);
    const { stdout } = await exec('du', ['-sb', dir]);
    diskMb = Math.round(parseInt(stdout.trim(), 10) / 1024 / 1024 * 100) / 100;
  } catch (e) {
    // ignore disk errors
  }

  // Uptime from container StartedAt
  try {
    const started = info.State.StartedAt ? new Date(info.State.StartedAt) : null;
    if (started) uptimeSeconds = Math.floor((Date.now() - started.getTime()) / 1000);
  } catch {}

  // Disk limit from the container's memory-style limit isn't a thing; use spec disk_mb if available
  try {
    const spec = await getContainerInfo(uuid);
    diskLimitMb = spec.disk_mb || 0;
  } catch {}

  return {
    running,
    cpu: Math.round(cpuPct * 100) / 100,
    memory_mb: memoryMb,
    memory_limit_mb: memoryLimitMb,
    disk_mb: diskMb,
    disk_limit_mb: diskLimitMb,
    network_rx_mb: netRxMb,
    network_tx_mb: netTxMb,
    uptime_seconds: uptimeSeconds,
  };
}

// ---- Spec management ----

export async function getContainerInfo(uuid) {
  try {
    const raw = await fs.readFile(path.join(botDir(uuid), 'spec.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    throw new Error('No spec found for bot');
  }
}

export async function updateSpec(uuid, patch) {
  const spec = await getContainerInfo(uuid);
  const next = { ...spec, ...patch };
  await fs.writeFile(path.join(botDir(uuid), 'spec.json'), JSON.stringify(next), 'utf8');
  return next;
}

// Rebuild the container from spec (applies env / startup command changes).
export async function recreateContainer(uuid) {
  const spec = await getContainerInfo(uuid);
  const container = await findContainer(uuid);
  if (container) {
    try { await container.kill(); } catch {}
    await container.remove({ force: true });
  }
  await createBot(spec);
  return { ok: true };
}

// ---- File operations (path-traversal safe) ----

function safeResolve(uuid, relPath) {
  const root = path.resolve(botDir(uuid));
  const rel = (relPath || '.').replace(/^\/+/, '');
  const target = rel === '' ? root : path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Invalid path');
  }
  return target;
}

export async function listFiles(uuid, relPath) {
  const dir = safeResolve(uuid, relPath);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (e) => {
    const full = path.join(dir, e.name);
    let size = 0;
    if (e.isFile()) {
      try { size = (await fs.stat(full)).size; } catch {}
    }
    return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size };
  }));
  return { path: relPath || '/', files };
}

export async function readFile(uuid, relPath) {
  const target = safeResolve(uuid, relPath);
  const content = await fs.readFile(target, 'utf8');
  return { path: relPath, content };
}

export async function writeFile(uuid, relPath, content) {
  const target = safeResolve(uuid, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
  return { ok: true };
}

export async function deleteFile(uuid, relPath) {
  const target = safeResolve(uuid, relPath);
  await fs.rm(target, { recursive: true, force: true });
  return { ok: true };
}

export async function renameFile(uuid, relPath, newPath) {
  const from = safeResolve(uuid, relPath);
  const to = safeResolve(uuid, newPath);
  await fs.rename(from, to);
  return { ok: true };
}

// ---- Console attach ----

export async function getInstallLog(uuid) {
  const dir = botDir(uuid);
  const logPath = path.join(dir, 'install.log');
  try {
    return await fs.readFile(logPath, 'utf8');
  } catch {
    return '';
  }
}

export async function attachConsole(uuid, onData, onClose) {
  const container = await findContainer(uuid);
  if (!container) throw new Error('Container not found');
  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
    stdin: true,
  });
  stream.on('data', (chunk) => onData(chunk));
  stream.on('end', onClose);
  stream.on('error', onClose);
  return stream;
}

// ---- Backups ----

function backupPath(name) {
  return path.join(config.botDataDir, 'backups', `${name}.tar.gz`);
}

export async function createBackup(uuid, name) {
  const dir = botDir(uuid);
  const backupDir = path.join(config.botDataDir, 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  const target = backupPath(name);
  await exec('tar', ['-czf', target, '-C', dir, '.']);
  const stat = await fs.stat(target);
  return { size_bytes: stat.size };
}

export async function restoreBackup(uuid, name) {
  const dir = botDir(uuid);
  const source = backupPath(name);
  const container = await findContainer(uuid);
  if (container) {
    try { await container.kill(); } catch {}
    await container.remove({ force: true });
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await exec('tar', ['-xzf', source, '-C', dir]);
  // Recreate the container from spec so the server stays usable
  const spec = await getContainerInfo(uuid);
  await createBot(spec);
  return { ok: true };
}

export async function deleteBackup(name) {
  await fs.rm(backupPath(name), { force: true });
  return { ok: true };
}

export async function backupExists(name) {
  try {
    await fs.access(backupPath(name));
    return true;
  } catch {
    return false;
  }
}

export async function getBackupPath(name) {
  return backupPath(name);
}

// ---- SFTP ----

export async function setSftpPassword(uuid, password) {
  const spec = await getContainerInfo(uuid);
  spec.sftp_password = password;
  await fs.writeFile(path.join(botDir(uuid), 'spec.json'), JSON.stringify(spec), 'utf8');
  return { ok: true };
}

export async function getSftpInfo(identifier) {
  // Find a server by its short identifier
  const dirs = await fs.readdir(config.botDataDir, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const spec = JSON.parse(await fs.readFile(path.join(config.botDataDir, d.name, 'spec.json'), 'utf8'));
      if (spec.identifier === identifier) {
        return { uuid: spec.uuid, dir: path.join(config.botDataDir, d.name), sftp_password: spec.sftp_password };
      }
    } catch {}
  }
  return null;
}
