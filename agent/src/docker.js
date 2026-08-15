import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import os from 'node:os';
import { createReadStream } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const exec = promisify(execFile);

const docker = new Docker();

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Previous CPU sample per container, used to compute real deltas between
// consecutive polls (Docker's one-shot stats don't provide reliable deltas).
const lastCpuSample = new Map();

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

// Find the MAIN server container, skipping the one-off install container
// (which shares the raven.uuid label but is marked raven.install=true).
export async function findMainContainer(uuid) {
  const containers = await docker.listContainers({ all: true });
  const hit = containers.find((c) => c.Labels && c.Labels['raven.uuid'] === uuid && c.Labels['raven.install'] !== 'true');
  if (hit) return docker.getContainer(hit.Id);
  return null;
}

export async function createBot({ uuid, identifier, image, startup_command, install_command, memory_mb, disk_mb, cpu, env, mounts = [], mount_target = '/home/container', sftp_password = null, io = 500, cpu_pinning = '', oom_killer = true, allocation_port = null, should_run = false }) {
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
    // Egg install scripts are authored with CRLF line endings; strip the \r so
    // `sh -c` doesn't choke on them.
    const cleanInstall = String(install_command).replace(/\r/g, '');
    console.log(`[agent] installing ${identifier}: ${cleanInstall.slice(0, 80)}…`);
    const installContainer = await docker.createContainer({
      Image: image,
      name: `${name}-install`,
      User: 'root',
      WorkingDir: '/mnt/server',
      // Pass the server's env vars (VERSION, BUILD, SERVER_JAR, …) so egg
      // install scripts actually use the user's configured values — without
      // this, VERSION was always empty and every install fell back to
      // "latest" (e.g. Minecraft always downloaded the newest Paper build).
      Env: Object.entries(env || {}).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        // Install scripts (apt/dpkg/pip/npm) need the default capabilities —
        // dropping ALL caps breaks apt's setgroups/seteuid and every egg's
        // install step fails with "Operation not permitted". The install
        // container is one-off and removed right after, so this is safe.
        Binds: [`${dir}:/mnt/server`],
        NetworkMode: net.id,
      },
      Cmd: ['bash', '-c', cleanInstall],
      AttachStdout: true,
      AttachStderr: true,
      Labels: { 'raven.uuid': uuid, 'raven.install': 'true' },
    });
    const logPath = path.join(dir, 'install.log');
    const logHandle = await fs.open(logPath, 'w');
    const installStream = await installContainer.attach({ stream: true, stdout: true, stderr: true });
    // Docker multiplexed streams can split a frame across chunks — buffer and
    // parse complete frames so install.log never contains binary header bytes.
    let frameBuf = Buffer.alloc(0);
    installStream.on('data', (chunk) => {
      frameBuf = Buffer.concat([frameBuf, chunk]);
      let out = '';
      let i = 0;
      while (i + 8 <= frameBuf.length) {
        const size = frameBuf.readUInt32BE(i + 4);
        if (size <= 0 || i + 8 + size > frameBuf.length) break;
        out += frameBuf.slice(i + 8, i + 8 + size).toString('utf8');
        i += 8 + size;
      }
      if (i > 0) frameBuf = frameBuf.slice(i);
      if (out) logHandle.write(out).catch(() => {});
    });
    await installContainer.start();
    await installContainer.wait();
    if (typeof installStream.end === 'function') installStream.end();
    else installStream.destroy?.();
    await logHandle.close();
    await installContainer.remove({ force: true });
  }

  // Persist the bot spec so reinstall / start can rebuild it
  await fs.writeFile(path.join(dir, 'spec.json'), JSON.stringify({
    uuid, identifier, image, startup_command, install_command, memory_mb, disk_mb, cpu, env, mounts, mount_target, io,
    allocation_port: allocation_port || null,
    sftp_password: sftp_password || null,
    should_run: !!should_run,
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
      // Publish the server's allocation port so players can connect
      ...(allocation_port ? {
        ExposedPorts: { [`${allocation_port}/tcp`]: {}, [`${allocation_port}/udp`]: {} },
        PortBindings: {
          [`${allocation_port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(allocation_port) }],
          [`${allocation_port}/udp`]: [{ HostIp: '0.0.0.0', HostPort: String(allocation_port) }],
        },
      } : {}),
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
      await updateSpec(uuid, { should_run: true });
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
      markExpectedStop(uuid);
      await updateSpec(uuid, { should_run: false });
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
      markExpectedStop(uuid);
      await updateSpec(uuid, { should_run: false });
      const container = await findContainer(uuid);
      if (!container) return { status: 'offline' };
      try {
        await container.kill();
      } catch (e) {
        // Killing a stopped container is a no-op — don't error out.
        if (!/not running/i.test(e.message)) throw e;
      }
      break;
    }
    default: throw new Error('Invalid action');
  }
  const container = await findContainer(uuid);
  const info = container ? await container.inspect() : null;
  return { status: info?.State.Running ? 'running' : 'offline' };
}

export async function removeBot(uuid, keepFiles = false) {
  markExpectedStop(uuid);
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
  // keep_files: used when the data dir is shared with another node/agent
  // (same-host transfers) — never delete it in that case.
  if (!keepFiles) {
    await fs.rm(botDir(uuid), { recursive: true, force: true });
  }
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
      const onlineCpus = stats.cpu_stats.online_cpus || 1;
      const cpuNow = stats.cpu_stats.cpu_usage.total_usage;
      const sysNow = stats.cpu_stats.system_cpu_usage || 0;
      // Docker's one-shot stats often return precpu_stats == cpu_stats (zero
      // delta), so we keep our own previous sample and compute the delta
      // between consecutive agent polls instead.
      const prev = lastCpuSample.get(uuid);
      if (prev && sysNow > prev.sys && cpuNow >= prev.cpu) {
        const cpuDelta = cpuNow - prev.cpu;
        const sysDelta = sysNow - prev.sys;
        if (cpuDelta <= sysDelta) {
          cpuPct = (cpuDelta / sysDelta) * onlineCpus * 100;
        }
      }
      lastCpuSample.set(uuid, { cpu: cpuNow, sys: sysNow });
      // Cap at the container's configured limit (NanoCpus) so the panel
      // never shows usage above what the server is actually allowed.
      const nanoLimit = info.HostConfig?.NanoCpus || 0;
      if (nanoLimit > 0) {
        cpuPct = Math.min(cpuPct, (nanoLimit / 1e9) * 100);
      }
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

  // Uptime from container StartedAt (only when running; offline containers often report Go zero time)
  try {
    const started = running && info.State.StartedAt ? new Date(info.State.StartedAt) : null;
    if (started && started.getFullYear() > 1) {
      uptimeSeconds = Math.floor((Date.now() - started.getTime()) / 1000);
    }
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
// Does NOT re-run the install step — that would wipe the server's setup.
export async function recreateContainer(uuid) {
  markExpectedStop(uuid);
  const spec = await getContainerInfo(uuid);
  const container = await findContainer(uuid);
  if (container) {
    try { await container.kill(); } catch {}
    await container.remove({ force: true });
  }
  await createBot({ ...spec, install_command: null });
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
    let modifiedAt = null;
    try {
      const st = await fs.stat(full);
      size = st.size;
      modifiedAt = st.mtime.toISOString();
    } catch {}
    return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size, modifiedAt };
  }));
  return { path: relPath || '/', files };
}

export async function readFile(uuid, relPath) {
  const target = safeResolve(uuid, relPath);
  const content = await fs.readFile(target, 'utf8');
  return { path: relPath, content };
}

export async function writeFile(uuid, relPath, content, encoding = 'utf8') {
  const target = safeResolve(uuid, relPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const data = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
  await fs.writeFile(target, data, encoding === 'base64' ? undefined : 'utf8');
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

export async function archiveFiles(uuid, relPaths, archiveName) {
  const root = safeResolve(uuid, '/');
  const outName = archiveName || `archive-${Date.now()}.tar.gz`;
  const outPath = path.join(root, outName);
  const args = ['-czf', outPath, ...relPaths.map((p) => p.replace(/^\/+/, ''))];
  await exec('tar', args, { cwd: root });
  return { ok: true, archive: outName };
}

export async function extractArchive(uuid, relPath) {
  const target = safeResolve(uuid, relPath);
  const root = safeResolve(uuid, '/');
  const lower = target.toLowerCase();
  if (lower.endsWith('.zip')) {
    await exec('unzip', ['-o', target, '-d', root], { cwd: root });
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await exec('tar', ['-xzf', target], { cwd: root });
  } else if (lower.endsWith('.tar')) {
    await exec('tar', ['-xf', target], { cwd: root });
  } else {
    throw new Error('Unsupported archive format');
  }
  return { ok: true };
}

// Create a tar.gz archive of the server's data dir (excluding spec.json) in
// the OS temp dir. Returns { path, size } — size lets the panel show progress.
export async function createTransferArchive(uuid) {
  const root = safeResolve(uuid, '/');
  const tarPath = path.join(os.tmpdir(), `raven-transfer-${uuid}-${Date.now()}.tar.gz`);
  await exec('tar', ['-czf', tarPath, '--exclude=spec.json', '.'], { cwd: root });
  const stat = await fs.stat(tarPath);
  return { path: tarPath, size: stat.size };
}

// Transfer this server's files to another agent (panel-orchestrated).
// `url` + `token` are the destination agent's import endpoint and daemon token.
export async function transferOut(uuid, url, token) {
  const { path: tarPath } = await createTransferArchive(uuid);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: createReadStream(tarPath),
      duplex: 'half',
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Destination agent rejected transfer (${res.status}): ${txt.slice(0, 200)}`);
    }
  } finally {
    await fs.rm(tarPath, { force: true });
  }
  return { ok: true };
}

// Extract a received tar.gz stream into the server's data directory.
export async function importArchive(uuid, tempPath) {
  const root = safeResolve(uuid, '/');
  await fs.mkdir(root, { recursive: true });
  await exec('tar', ['-xzf', tempPath], { cwd: root });
  return { ok: true };
}

export async function createFolder(uuid, relPath) {
  const target = safeResolve(uuid, relPath);
  await fs.mkdir(target, { recursive: true });
  return { ok: true };
}

export function downloadFilePath(uuid, relPath) {
  return safeResolve(uuid, relPath);
}

// ---- Plugins ----

// Install a plugin jar into the server's plugins directory.
// The jar is downloaded by the agent (which has internet access) so the
// panel never has to proxy binary data.
export async function installPlugin(uuid, url, filename) {
  if (!url || !/^https?:\/\//.test(url)) throw new Error('Invalid plugin URL');
  const safe = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safe.endsWith('.jar')) throw new Error('Plugin must be a .jar file');
  const pluginsDir = path.join(botDir(uuid), 'plugins');
  await fs.mkdir(pluginsDir, { recursive: true });
  const target = path.join(pluginsDir, safe);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('Downloaded file is too small to be a plugin');
  await fs.writeFile(target, buf);
  return { ok: true, filename: safe, size: buf.length };
}

export async function listPlugins(uuid) {
  const pluginsDir = path.join(botDir(uuid), 'plugins');
  try {
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    const plugins = await Promise.all(entries.filter((e) => e.isFile() && e.name.endsWith('.jar')).map(async (e) => {
      const st = await fs.stat(path.join(pluginsDir, e.name));
      return { name: e.name, size: st.size, modified_at: st.mtime.toISOString() };
    }));
    return { plugins };
  } catch {
    return { plugins: [] };
  }
}

export async function deletePlugin(uuid, filename) {
  const safe = String(filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const target = path.join(botDir(uuid), 'plugins', safe);
  await fs.rm(target, { force: true });
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

// Stream the server's install log (tail -F) so the console can show live
// install output while the main container doesn't exist yet (any egg).
// Returns { stop } to kill the tail.
export async function streamInstallLog(uuid, onData, onClose) {
  const logPath = path.join(botDir(uuid), 'install.log');
  // The install step may not have started writing yet — wait briefly.
  for (let i = 0; i < 10; i++) {
    try { await fs.access(logPath); break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  try { await fs.access(logPath); } catch { throw new Error('No install log yet'); }
  const tail = spawn('tail', ['-F', '-n', '+1', logPath]);
  tail.stdout.on('data', (chunk) => onData(chunk));
  tail.on('error', () => {});
  tail.on('close', () => { try { onClose && onClose(); } catch {} });
  return {
    stop: () => { try { tail.kill('SIGTERM'); } catch {} },
  };
}

// ---- Backups ----

function backupPath(name) {
  // Only allow safe backup names (UUIDs from the panel) — never let a
  // caller escape the backups dir via path traversal.
  const safe = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '');
  return path.join(config.botDataDir, 'backups', `${safe}.tar.gz`);
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

// ---- Host stats (node health) ----

const hostCpuSample = { idle: 0, total: 0 };

// The host's primary IPv4 address (public IP on a VPS). Prefers an external
// IP service because the primary interface may be a private NAT address on
// some VPSes (e.g. 10.x behind QEMU/KVM).
export async function getHostIp() {
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const ip = (await res.text()).trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    }
  } catch {}
  try {
    const { stdout } = await exec('hostname', ['-I']);
    const ip = stdout.trim().split(/\s+/).find((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x));
    return ip || null;
  } catch {
    return null;
  }
}

// TCP proxy container: forwards 0.0.0.0:<port> -> <target> (e.g. a remote
// node's game port). Used when a remote node's FQDN points at the panel host
// so players can reach the game server through the panel's IP.
export async function createProxy(port, target) {
  const name = `raven-proxy-${port}`;
  try {
    const existing = docker.getContainer(name);
    await existing.remove({ force: true });
  } catch {}
  await pullImage('alpine/socat');
  const container = await docker.createContainer({
    Image: 'alpine/socat',
    name,
    HostConfig: {
      PortBindings: { [`${port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: String(port) }] },
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Cmd: ['TCP-LISTEN:' + port + ',fork,reuseaddr', 'TCP:' + target],
    Labels: { 'raven.proxy': 'true' },
  });
  await container.start();
  return { ok: true, name };
}

export async function removeProxy(port) {
  try {
    const c = docker.getContainer(`raven-proxy-${port}`);
    await c.remove({ force: true });
  } catch {}
  return { ok: true };
}

export async function listProxies() {
  const containers = await docker.listContainers({ all: true });
  const proxies = [];
  for (const c of containers) {
    if (c.Labels && c.Labels['raven.proxy'] === 'true') {
      const port = (c.Names[0] || '').replace(/^\/raven-proxy-/, '');
      proxies.push({ name: c.Names[0], port: parseInt(port, 10) || null, state: c.State });
    }
  }
  return { proxies };
}

// Live host-level metrics: CPU, RAM, disk, load, uptime, container counts.
// Used by the panel's node health dashboard.
export async function getHostStats() {
  // CPU from /proc/stat deltas (two samples)
  let cpuPct = 0;
  try {
    const stat = await fs.readFile('/proc/stat', 'utf8');
    const line = stat.split('\n').find((l) => l.startsWith('cpu '));
    if (line) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      if (hostCpuSample.total > 0 && total > hostCpuSample.total) {
        const idleDelta = idle - hostCpuSample.idle;
        const totalDelta = total - hostCpuSample.total;
        cpuPct = Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100));
      }
      hostCpuSample.idle = idle;
      hostCpuSample.total = total;
    }
  } catch {}

  // RAM from /proc/meminfo
  let memTotalMb = 0, memFreeMb = 0;
  try {
    const mem = await fs.readFile('/proc/meminfo', 'utf8');
    const get = (k) => {
      const m = mem.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) / 1024 : 0;
    };
    memTotalMb = get('MemTotal');
    memFreeMb = get('MemAvailable') || get('MemFree');
  } catch {}

  // Disk usage of the bot data dir
  let diskTotalMb = 0, diskUsedMb = 0;
  try {
    const { stdout } = await exec('df', ['-B1', config.botDataDir]);
    const lines = stdout.trim().split('\n');
    if (lines.length > 1) {
      const parts = lines[1].split(/\s+/);
      diskTotalMb = Math.round(parseInt(parts[1], 10) / 1024 / 1024);
      diskUsedMb = Math.round(parseInt(parts[2], 10) / 1024 / 1024);
    }
  } catch {}

  // Load average
  let load = [0, 0, 0];
  try {
    const l = await fs.readFile('/proc/loadavg', 'utf8');
    load = l.trim().split(/\s+/).slice(0, 3).map(Number);
  } catch {}

  // Uptime of the VPS host (from /proc/uptime)
  let uptimeSeconds = 0;
  try {
    const u = await fs.readFile('/proc/uptime', 'utf8');
    uptimeSeconds = Math.floor(parseFloat(u.trim().split(/\s+/)[0]));
  } catch {}

  // Container counts
  let containers = { total: 0, running: 0 };
  try {
    const list = await docker.listContainers({ all: true });
    containers.total = list.length;
    containers.running = list.filter((c) => c.State === 'running').length;
  } catch {}

  return {
    online: true,
    cpu: Math.round(cpuPct * 100) / 100,
    memory_total_mb: Math.round(memTotalMb),
    memory_used_mb: Math.round(memTotalMb - memFreeMb),
    disk_total_mb: diskTotalMb,
    disk_used_mb: diskUsedMb,
    load,
    uptime_seconds: uptimeSeconds,
    containers,
  };
}

// ---- Crash detection + auto-restart with backoff ----

// UUIDs the panel intentionally stopped (stop/kill/remove/recreate) — the
// crash monitor ignores their exit events.
const expectedStops = new Set();
// uuid -> { attempts, timer }
const crashState = new Map();

export function markExpectedStop(uuid) {
  expectedStops.add(uuid);
}

// Watch Docker events. When a server container exits unexpectedly, restart it
// with exponential backoff (5s -> 10s -> 20s -> 40s -> 60s, max 5 attempts).
export function startCrashMonitor() {
  const watch = () => {
    docker.getEvents({ filters: { type: ['container'] } })
      .then((stream) => {
        stream.on('data', (chunk) => {
          try {
            const evt = JSON.parse(chunk.toString());
            if (evt.status !== 'die') return;
            const attrs = evt.Actor?.Attributes || {};
            // Ignore install containers and non-raven containers
            if (attrs['raven.install'] === 'true') return;
            const uuid = attrs['raven.uuid'];
            if (!uuid) return;
            if (expectedStops.has(uuid)) { expectedStops.delete(uuid); return; }
            scheduleRestart(uuid);
          } catch {}
        });
        stream.on('error', () => setTimeout(watch, 5000));
        stream.on('end', () => setTimeout(watch, 5000));
      })
      .catch(() => setTimeout(watch, 5000));
  };
  watch();
  console.log('[agent] crash monitor started');
}

function scheduleRestart(uuid) {
  const st = crashState.get(uuid) || { attempts: 0, timer: null };
  if (st.attempts >= 5) {
    console.log(`[agent] giving up on ${uuid} after 5 crash attempts`);
    crashState.delete(uuid);
    return;
  }
  const delay = Math.min(60000, 5000 * Math.pow(2, st.attempts));
  st.attempts++;
  clearTimeout(st.timer);
  st.timer = setTimeout(async () => {
    try {
      const spec = await getContainerInfo(uuid);
      if (!spec.should_run) { crashState.delete(uuid); return; }
      const container = await findContainer(uuid);
      if (!container) { crashState.delete(uuid); return; }
      const info = await container.inspect();
      if (info.State.Running) { crashState.delete(uuid); return; }
      await container.start();
      console.log(`[agent] auto-restarted ${uuid} (attempt ${st.attempts}, delay ${delay}ms)`);
      crashState.delete(uuid);
    } catch (e) {
      console.error(`[agent] auto-restart failed for ${uuid}:`, e.message);
    }
  }, delay);
  crashState.set(uuid, st);
}

// After an agent/host restart, bring back every server that was running
// (spec.should_run === true).
export async function restoreRunningContainers() {
  let dirs = [];
  try { dirs = await fs.readdir(config.botDataDir, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const spec = JSON.parse(await fs.readFile(path.join(config.botDataDir, d.name, 'spec.json'), 'utf8'));
      if (spec.should_run) {
        const container = await findContainer(spec.uuid);
        if (container) {
          const info = await container.inspect();
          if (!info.State.Running) {
            await container.start();
            console.log(`[agent] restored ${spec.uuid} after restart`);
          }
        }
      }
    } catch {}
  }
}
