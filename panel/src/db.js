import pg from 'pg';
import crypto from 'node:crypto';
import { databaseUrl, config } from './config.js';

export const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  root_admin BOOLEAN NOT NULL DEFAULT false,
  language TEXT NOT NULL DEFAULT 'en',
  suspended BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short TEXT UNIQUE NOT NULL,
  long TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  fqdn TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 8080,
  scheme TEXT NOT NULL DEFAULT 'https',
  visibility TEXT NOT NULL DEFAULT 'public',
  behind_proxy BOOLEAN NOT NULL DEFAULT false,
  file_directory TEXT NOT NULL DEFAULT '/var/lib/raven/bots',
  sftp_port INTEGER NOT NULL DEFAULT 2022,
  memory_mb INTEGER NOT NULL DEFAULT 0,
  memory_overallocate INTEGER NOT NULL DEFAULT 0,
  disk_mb INTEGER NOT NULL DEFAULT 0,
  disk_overallocate INTEGER NOT NULL DEFAULT 0,
  cpu_cores INTEGER NOT NULL DEFAULT 0,
  cpu_overallocate INTEGER NOT NULL DEFAULT 0,
  daemon_token TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  ip TEXT NOT NULL DEFAULT '0.0.0.0',
  port INTEGER NOT NULL,
  server_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, port)
);

CREATE TABLE IF NOT EXISTS nests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eggs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  nest_id UUID NOT NULL REFERENCES nests(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  docker_image TEXT NOT NULL,
  startup_command TEXT NOT NULL,
  default_install_command TEXT,
  skip_install BOOLEAN NOT NULL DEFAULT false,
  mount_target TEXT NOT NULL DEFAULT '/home/container',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS egg_variables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  egg_id UUID NOT NULL REFERENCES eggs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  env_variable TEXT NOT NULL,
  default_value TEXT NOT NULL DEFAULT '',
  user_viewable BOOLEAN NOT NULL DEFAULT true,
  user_editable BOOLEAN NOT NULL DEFAULT true,
  rules TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  identifier TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  node_id UUID NOT NULL REFERENCES nodes(id),
  nest_id UUID NOT NULL REFERENCES nests(id),
  egg_id UUID NOT NULL REFERENCES eggs(id),
  status TEXT NOT NULL DEFAULT 'installing',
  memory_mb INTEGER NOT NULL DEFAULT 512,
  cpu INTEGER NOT NULL DEFAULT 100,
  cpu_pinning TEXT NOT NULL DEFAULT '',
  disk_mb INTEGER NOT NULL DEFAULT 1536,
  swap_mb INTEGER NOT NULL DEFAULT 0,
  io INTEGER NOT NULL DEFAULT 500,
  oom_killer BOOLEAN NOT NULL DEFAULT true,
  databases INTEGER NOT NULL DEFAULT 1,
  allocations INTEGER NOT NULL DEFAULT 1,
  backups INTEGER NOT NULL DEFAULT 0,
  startup_command TEXT,
  docker_image TEXT,
  skip_install BOOLEAN NOT NULL DEFAULT false,
  start_on_install BOOLEAN NOT NULL DEFAULT false,
  env JSONB NOT NULL DEFAULT '{}',
  container_id TEXT,
  sftp_password TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_subusers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_databases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  database_name TEXT NOT NULL,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT 'mariadb',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uuid TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  read_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mount_servers (
  mount_id UUID NOT NULL REFERENCES mounts(id) ON DELETE CASCADE,
  server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  PRIMARY KEY (mount_id, server_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions JSONB NOT NULL DEFAULT '[]',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

export async function initDb() {
  await pool.query(SCHEMA);
  // Migrations for existing tables
  await pool.query(`ALTER TABLE servers ALTER COLUMN user_id DROP NOT NULL`);
  await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS sftp_password TEXT`);
  await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS cpu_pinning TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS oom_killer BOOLEAN DEFAULT true`);
  await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS skip_install BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE servers ADD COLUMN IF NOT EXISTS start_on_install BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'public'`);
  await pool.query(`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS behind_proxy BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS file_directory TEXT DEFAULT '/var/lib/raven/bots'`);
  await pool.query(`ALTER TABLE nodes ADD COLUMN IF NOT EXISTS sftp_port INTEGER DEFAULT 2022`);
  await seedDefaults();
  console.log('[db] schema ready');
}

async function seedDefaults() {
  // Default location
  await pool.query(
    `INSERT INTO locations (short, long) VALUES ('default', 'Default Location')
     ON CONFLICT (short) DO NOTHING`
  );

  // Default nest + eggs (auto-discovered from panel/eggs/*.json)
  const nest = await q1(`SELECT id FROM nests WHERE name = 'Generic'`);
  let nestId = nest?.id;
  if (!nestId) {
    const n = await q1(`INSERT INTO nests (uuid, name, description) VALUES ($1, 'Generic', 'Generic application eggs') RETURNING id`, [genUuid()]);
    nestId = n.id;
  }

  // Auto-import every egg file in panel/eggs/ — no hardcoded list.
  // Drop a new .json in that folder and restart the panel to add an egg.
  const { readdirSync } = await import('fs');
  const pathMod = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = pathMod.dirname(fileURLToPath(import.meta.url));
  const eggsDir = pathMod.join(__dirname, '..', 'eggs');
  const eggFiles = readdirSync(eggsDir).filter((f) => f.endsWith('.json'));
  for (const file of eggFiles) {
    await importEgg(pathMod.basename(file, '.json'), nestId);
  }

  // Seed the local node from config.yml
  const existing = await q1(`SELECT id FROM nodes WHERE name = $1`, [config.node.name]);
  const loc = await q1(`SELECT id FROM locations WHERE short = 'default'`);
  const nodeData = [
    genUuid(), config.node.name, loc.id, config.node.fqdn, config.node.port, 'https',
    config.node.memory_mb, config.node.memory_overallocate,
    config.node.disk_mb, config.node.disk_overallocate,
    config.node.cpu_cores, config.node.cpu_overallocate,
    config.security.agent_token,
  ];
  if (existing) {
    await pool.query(
      `UPDATE nodes SET uuid=$1, name=$2, location_id=$3, fqdn=$4, port=$5, scheme=$6,
       memory_mb=$7, memory_overallocate=$8, disk_mb=$9, disk_overallocate=$10,
       cpu_cores=$11, cpu_overallocate=$12, daemon_token=$13, enabled=true
       WHERE name=$14`,
      [...nodeData, config.node.name]
    );
  } else {
    await pool.query(
      `INSERT INTO nodes (uuid, name, location_id, fqdn, port, scheme, memory_mb, memory_overallocate, disk_mb, disk_overallocate, cpu_cores, cpu_overallocate, daemon_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      nodeData
    );
  }

  // Seed default allocations for the node (ports 25565-25575)
  const node = await q1(`SELECT id FROM nodes WHERE name = $1`, [config.node.name]);
  for (let p = 25565; p <= 25575; p++) {
    await pool.query(
      `INSERT INTO allocations (node_id, ip, port) VALUES ($1, '0.0.0.0', $2)
       ON CONFLICT (node_id, port) DO NOTHING`,
      [node.id, p]
    );
  }

  // Default settings
  const defaults = {
    'app.name': config.app.name,
    'app.description': config.app.description,
    'app.url': config.app.url,
    'app.timezone': config.app.timezone,
    'app.locale': config.app.locale,
    'panel.registration': 'true',
    'panel.announcement': '',
  };
  for (const [k, v] of Object.entries(defaults)) {
    await pool.query(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`, [k, v]);
  }

  console.log('[db] defaults seeded');
}

async function importEgg(name, nestId) {
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(__dirname, '..', 'eggs', `${name}.json`);
  if (!fs.existsSync(file)) return;
  const egg = JSON.parse(fs.readFileSync(file, 'utf8'));

  const images = Object.values(egg.docker_images || {});
  const image = images[0] || 'ghcr.io/parkervcp/yolks:debian';
  const installScript = egg.scripts?.installation?.script || '';
  const installContainer = egg.scripts?.installation?.container || 'ghcr.io/parkervcp/yolks:debian';

  const existing = await q1(`SELECT id FROM eggs WHERE name = $1 AND nest_id = $2`, [egg.name, nestId]);
  let eggId;
  if (existing) {
    await pool.query(
      `UPDATE eggs SET docker_image=$1, startup_command=$2, default_install_command=$3, description=$4 WHERE id=$5`,
      [image, egg.startup, installScript, egg.description, existing.id]
    );
    eggId = existing.id;
    await pool.query(`DELETE FROM egg_variables WHERE egg_id = $1`, [eggId]);
  } else {
    const e = await q1(
      `INSERT INTO eggs (uuid, nest_id, name, description, docker_image, startup_command, default_install_command, mount_target)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'/home/container') RETURNING id`,
      [genUuid(), nestId, egg.name, egg.description, image, egg.startup, installScript]
    );
    eggId = e.id;
  }

  for (const v of egg.variables || []) {
    await pool.query(
      `INSERT INTO egg_variables (egg_id, name, description, env_variable, default_value, user_viewable, user_editable, rules)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [eggId, v.name, v.description || '', v.env_variable, v.default_value || '', !!v.user_viewable, !!v.user_editable, v.rules || '']
    );
  }
  console.log(`[db] egg imported: ${egg.name}`);
}

export function genUuid() {
  return crypto.randomUUID();
}

export function genIdentifier() {
  return crypto.randomBytes(4).toString('hex');
}

export async function q(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

export async function q1(text, params) {
  const rows = await q(text, params);
  return rows[0];
}
