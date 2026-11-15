import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export async function getSetting<T>(key: string, fallback: T, client?: PoolClient): Promise<T> {
  const executor = client ?? pool;
  const result = await executor.query<{ value: T }>(
    'SELECT value FROM settings WHERE key = $1',
    [key]
  );
  return result.rows[0]?.value ?? fallback;
}

export async function setSetting<T>(key: string, value: T, client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
