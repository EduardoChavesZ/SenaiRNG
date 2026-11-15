import { createHash, randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pool } from '../db/pool.js';

export const SESSION_COOKIE = 'rng_session';
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashSessionToken(token), new Date(Date.now() + SESSION_DURATION_MS)]
  );
  return token;
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: 'user' | 'admin' };
    }
  }
}

export const sessionMiddleware: RequestHandler = async (request, _response, next) => {
  try {
    const token = request.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string') {
      next();
      return;
    }

    const result = await pool.query<{ id: string; role: 'user' | 'admin' }>(
      `SELECT users.id, users.role
       FROM user_sessions
       JOIN users ON users.id = user_sessions.user_id
       WHERE user_sessions.token_hash = $1
         AND user_sessions.expires_at > now()
         AND user_sessions.revoked_at IS NULL
         AND users.deleted_at IS NULL`,
      [hashSessionToken(token)]
    );
    if (result.rows[0]) request.user = result.rows[0];
    next();
  } catch (error) {
    next(error);
  }
};
