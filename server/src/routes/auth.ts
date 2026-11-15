import argon2 from 'argon2';
import { Router } from 'express';
import { z } from 'zod';
import { inTransaction } from '../db/transaction.js';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { asyncHandler } from '../http/async-handler.js';
import { SESSION_COOKIE, SESSION_DURATION_MS, createSession, hashSessionToken } from '../http/session.js';
import { cookieSecure } from '../config.js';
import { getSetting } from '../services/settings.js';

const router = Router();
const credentialsSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(10).max(128)
});
const cookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: SESSION_DURATION_MS
};

router.get('/login-config', asyncHandler(async (_request, response) => {
  const music = await getSetting<{ videoId: string; authorizedAt: string; authorizedBy: string } | null>('login_music', null);
  const videoId = music
    && /^[A-Za-z0-9_-]{11}$/.test(music.videoId)
    && music.authorizedAt
    && music.authorizedBy
    ? music.videoId
    : null;
  response.json({ musicVideoId: videoId });
}));

router.post('/register', asyncHandler(async (request, response) => {
  const { email, password } = credentialsSchema.parse(request.body);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await inTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'user')
       RETURNING id`,
      [email, passwordHash]
    );
    const userId = inserted.rows[0]!.id;
    const setting = await client.query<{ value: number }>(
      `SELECT value::text::integer AS value FROM settings WHERE key = 'signup_bonus'`
    );
    if (!setting.rows[0]) {
      throw new AppError('As configurações iniciais ainda não foram preparadas.', 503);
    }
    const bonus = setting.rows[0].value;
    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, $2)', [userId, bonus]);
    if (bonus > 0) {
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, reference_type, reference_id)
         VALUES ($1, 'signup_bonus', $2, $2, 'user', $3)`,
        [userId, bonus, userId]
      );
    }
    return { id: userId, role: 'user' as const };
  });

  const token = await createSession(user.id);
  response.cookie(SESSION_COOKIE, token, cookieOptions);
  response.status(201).json({ user: { id: user.id, email, role: user.role } });
}));

router.post('/login', asyncHandler(async (request, response) => {
  const { email, password } = credentialsSchema.parse(request.body);
  const result = await pool.query<{ id: string; password_hash: string; role: 'user' | 'admin' }>(
    `SELECT id, password_hash, role FROM users
     WHERE lower(email) = $1 AND deleted_at IS NULL`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await argon2.verify(user.password_hash, password))) {
    throw new AppError('E-mail ou senha incorretos.', 401);
  }

  const token = await createSession(user.id);
  response.cookie(SESSION_COOKIE, token, cookieOptions);
  response.json({ user: { id: user.id, email, role: user.role } });
}));

router.post('/logout', asyncHandler(async (request, response) => {
  const token = request.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') {
    await pool.query(
      'UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hashSessionToken(token)]
    );
  }
  response.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
  response.status(204).end();
}));

router.get('/me', asyncHandler(async (request, response) => {
  if (!request.user) {
    response.json({ user: null });
    return;
  }
  const result = await pool.query<{ email: string }>(
    'SELECT email FROM users WHERE id = $1',
    [request.user.id]
  );
  response.json({
    user: {
      id: request.user.id,
      email: result.rows[0]!.email,
      role: request.user.role
    }
  });
}));

export default router;
