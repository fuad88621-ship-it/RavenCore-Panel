import jwt from 'jsonwebtoken';
import { config, agentInternalUrl } from './config.js';
import { q } from './db.js';

// Node-aware agent client. By default requests go to the local agent
// (agentInternalUrl). Pass opts.node = a row from the `nodes` table to route
// to that node's agent instead (multi-node support). The local node always
// uses the internal Docker-network URL — its public FQDN only proxies the
// console WebSocket, not the agent API.
export async function agentRequest(path, method = 'GET', body, opts = {}) {
  const node = opts.node || null;
  const isLocal = node && (node.name === config.node.name || node.fqdn === config.node.fqdn);
  const base = node && !isLocal
    ? `${node.scheme || 'http'}://${node.fqdn}:${node.port}`
    : agentInternalUrl;
  const token = node && !isLocal ? node.daemon_token : config.security.agent_token;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (opts.raw) {
    if (!res.ok) throw new Error(`Agent error (${res.status})`);
    return { body: res.body, headers: Object.fromEntries(res.headers.entries()) };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Agent error (${res.status})`);
  return data;
}

// Look up the node a server lives on (for routing agent requests).
export async function serverNode(uuid) {
  const rows = await q(
    `SELECT n.* FROM servers s JOIN nodes n ON n.id = s.node_id WHERE s.uuid = $1`,
    [uuid]
  );
  return rows[0] || null;
}

// Convenience wrapper: route an agent request to the node hosting `uuid`.
export async function agentRequestFor(uuid, path, method = 'GET', body, opts = {}) {
  const node = await serverNode(uuid);
  return agentRequest(path, method, body, { ...opts, node });
}

export function consoleToken(server) {
  return jwt.sign(
    { sub: server.uuid, server: server.identifier, scope: 'console', exp: Math.floor(Date.now() / 1000) + 600 },
    config.security.console_secret,
    { algorithm: 'HS256' }
  );
}
