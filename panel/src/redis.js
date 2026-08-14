import Redis from 'ioredis';
import crypto from 'node:crypto';
import { redisUrl } from './config.js';

export const redis = new Redis(redisUrl, { lazyConnect: true });

export async function initRedis() {
  await redis.connect();
  console.log('[redis] connected');
}

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(`session:${token}`, userId, 'EX', SESSION_TTL);
  return token;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const userId = await redis.get(`session:${token}`);
  return userId;
}

export async function destroySession(token) {
  if (token) await redis.del(`session:${token}`);
}
