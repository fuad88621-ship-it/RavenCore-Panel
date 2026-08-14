import jwt from 'jsonwebtoken';
import { config } from './config.js';

export async function agentRequest(path, method = 'GET', body) {
  const res = await fetch(`${config.agentInternalUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Agent error (${res.status})`);
  return data;
}

export function consoleToken(bot) {
  // One-time JWT the browser uses to connect to the agent console WS.
  return jwt.sign(
    { sub: bot.uuid, bot: bot.identifier, scope: 'console', exp: Math.floor(Date.now() / 1000) + 600 },
    config.consoleSecret,
    { algorithm: 'HS256' }
  );
}
