import jwt from 'jsonwebtoken';
import { config, agentInternalUrl } from './config.js';

export async function agentRequest(path, method = 'GET', body) {
  const res = await fetch(`${agentInternalUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.security.agent_token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Agent error (${res.status})`);
  return data;
}

export function consoleToken(server) {
  return jwt.sign(
    { sub: server.uuid, server: server.identifier, scope: 'console', exp: Math.floor(Date.now() / 1000) + 600 },
    config.security.console_secret,
    { algorithm: 'HS256' }
  );
}
