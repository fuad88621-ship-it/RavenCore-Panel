import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, '..', '..', 'config.yml');

// Interpolate ${ENV_VAR} references in the raw YAML with process.env values.
function interpolate(raw) {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (m, name) => process.env[name] ?? m);
}

let raw;
try {
  raw = fs.readFileSync(CONFIG_PATH, 'utf8');
} catch {
  raw = '';
}

const parsed = yaml.parse(interpolate(raw)) || {};

const cfg = {
  app: {
    name: parsed.app?.name || 'Raven Panel',
    description: parsed.app?.description || 'Bot hosting panel',
    url: parsed.app?.url || process.env.PANEL_URL || 'http://localhost:3000',
    timezone: parsed.app?.timezone || 'UTC',
    locale: parsed.app?.locale || 'en',
  },
  panel: {
    port: parseInt(parsed.panel?.port || process.env.PORT || '3000'),
  },
  database: {
    host: parsed.database?.host || 'postgres',
    port: parseInt(parsed.database?.port || '5432'),
    user: parsed.database?.user || 'raven',
    password: parsed.database?.password || process.env.DB_PASSWORD,
    name: parsed.database?.name || 'raven',
  },
  redis: {
    host: parsed.redis?.host || 'redis',
    port: parseInt(parsed.redis?.port || '6379'),
  },
  node: {
    name: parsed.node?.name || process.env.NODE_NAME || 'Node-01',
    fqdn: parsed.node?.fqdn || process.env.NODE_FQDN || 'localhost',
    port: parseInt(parsed.node?.port || process.env.NODE_PORT || '8080'),
    memory_mb: parseInt(parsed.node?.memory_mb || process.env.NODE_MEMORY_MB || '7680'),
    disk_mb: parseInt(parsed.node?.disk_mb || process.env.NODE_DISK_MB || '80000'),
    cpu_cores: parseInt(parsed.node?.cpu_cores || process.env.NODE_CPU_CORES || '4'),
    memory_overallocate: parseInt(parsed.node?.memory_overallocate || '0'),
    disk_overallocate: parseInt(parsed.node?.disk_overallocate || '0'),
    cpu_overallocate: parseInt(parsed.node?.cpu_overallocate || '0'),
  },
  security: {
    session_secret: parsed.security?.session_secret || process.env.SESSION_SECRET,
    agent_token: parsed.security?.agent_token || process.env.AGENT_TOKEN,
    console_secret: parsed.security?.console_secret || process.env.CONSOLE_SECRET || process.env.AGENT_TOKEN,
    rate_limit: parseInt(parsed.security?.rate_limit || '20'),
    require_email_verify: !!parsed.security?.require_email_verify,
  },
  defaults: {
    memory_mb: parseInt(parsed.defaults?.memory_mb || '512'),
    disk_mb: parseInt(parsed.defaults?.disk_mb || '1536'),
    cpu: parseInt(parsed.defaults?.cpu || '100'),
    swap_mb: parseInt(parsed.defaults?.swap_mb || '0'),
    io: parseInt(parsed.defaults?.io || '500'),
    databases: parseInt(parsed.defaults?.databases || '1'),
    allocations: parseInt(parsed.defaults?.allocations || '1'),
    backups: parseInt(parsed.defaults?.backups || '0'),
  },
  databaseServer: {
    host: parsed.database_server?.host || 'mariadb',
    port: parseInt(parsed.database_server?.port || '3306'),
    user: parsed.database_server?.user || 'raven',
    password: parsed.database_server?.password || process.env.DB_PASSWORD,
    root_password: parsed.database_server?.root_password || process.env.DB_PASSWORD,
  },
};

export const config = cfg;
export const databaseUrl = `postgres://${cfg.database.user}:${cfg.database.password}@${cfg.database.host}:${cfg.database.port}/${cfg.database.name}`;
export const redisUrl = `redis://${cfg.redis.host}:${cfg.redis.port}`;
export const agentInternalUrl = process.env.AGENT_INTERNAL_URL || 'http://agent:8080';
