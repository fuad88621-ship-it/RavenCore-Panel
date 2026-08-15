import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Docker from 'dockerode';

const docker = new Docker();

const INSTALL_DIR = process.env.INSTALL_DIR || '/opt/raven';
const BACKUPS_DIR = path.join(INSTALL_DIR, 'backups');
const BOT_DATA_DIR = process.env.BOT_DATA_DIR || '/var/lib/raven/bots';
const COMPOSE_PROJECT = path.basename(INSTALL_DIR);

function envPath() {
  return path.join(INSTALL_DIR, '.env');
}

function readEnv() {
  const data = {};
  try {
    const text = fs.readFileSync(envPath(), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (m) data[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // ignore missing .env
  }
  return data;
}

function containerName(service) {
  // Docker Compose default naming: <project>_<service>_<number>
  return `${COMPOSE_PROJECT}-${service}-1`;
}

// Run a command inside a container and return its stdout (uses the Docker
// API — the agent image has no docker CLI).
async function execInContainer(containerName, cmd) {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: ['sh', '-c', cmd],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start();
  let output = '';
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => { output += chunk.toString(); });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return output;
}

export async function createBackup() {
  const env = readEnv();
  const dbPassword = env.DB_PASSWORD || '';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workDir = path.join(BACKUPS_DIR, `work-${timestamp}`);
  const archiveName = `raven-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(BACKUPS_DIR, archiveName);

  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // 1. Dump Postgres (capture stdout via the Docker API)
    const pgSql = await execInContainer(containerName('postgres'), 'pg_dump -U raven raven');
    fs.writeFileSync(path.join(workDir, 'postgres.sql'), pgSql);

    // 2. Dump MariaDB — use mariadb-dump (the mariadb:11 image has no
    // mysqldump binary) as root (the raven user lacks --all-databases
    // privileges on the mysql system tables).
    const mySql = await execInContainer(containerName('mariadb'), `mariadb-dump -u root -p'${dbPassword}' --all-databases`);
    fs.writeFileSync(path.join(workDir, 'mariadb.sql'), mySql);

    // 3. Copy config files
    for (const f of ['.env', 'config.yml', 'Caddyfile', 'docker-compose.yml']) {
      const src = path.join(INSTALL_DIR, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workDir, f));
    }

    // 4. Archive bot data using a temp tar (to avoid including the work dir)
    const botsArchive = path.join(workDir, 'bots.tar.gz');
    execSync(`tar -czf ${botsArchive} -C ${path.dirname(BOT_DATA_DIR)} ${path.basename(BOT_DATA_DIR)}`, { stdio: 'pipe' });

    // 5. Create final archive
    execSync(`tar -czf ${archivePath} -C ${workDir} .`, { stdio: 'pipe' });

    // 6. Clean up work dir
    fs.rmSync(workDir, { recursive: true, force: true });

    const stats = fs.statSync(archivePath);
    return { archive: archiveName, path: archivePath, size_bytes: stats.size, created_at: new Date().toISOString() };
  } catch (e) {
    // Clean up on failure
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(archivePath); } catch {}
    throw e;
  }
}

export function listBackups() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith('raven-backup-') && f.endsWith('.tar.gz'))
    .map((f) => {
      const p = path.join(BACKUPS_DIR, f);
      const st = fs.statSync(p);
      return { name: f, size_bytes: st.size, created_at: st.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return files;
}

export function getBackupPath(name) {
  const p = path.join(BACKUPS_DIR, path.basename(name));
  if (!fs.existsSync(p)) throw new Error('Backup not found');
  return p;
}
