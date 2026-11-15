import argon2 from 'argon2';
import { config } from '../config.js';
import { inTransaction } from './transaction.js';
import { pool } from './pool.js';

async function seed(): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES
      ('signup_bonus', $1::jsonb),
      ('daily_claim_amount', $2::jsonb),
      ('draw_cost', $3::jsonb),
      ('distribution_mode', '"individual"'),
      ('rarity_card_selection', '"equal"'),
      ('draw_max_quantity', '10')
     ON CONFLICT (key) DO NOTHING`,
    [
      JSON.stringify(config.SIGNUP_BONUS),
      JSON.stringify(config.DAILY_CLAIM_AMOUNT),
      JSON.stringify(config.DRAW_COST)
    ]
  );

  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    console.log('No admin credentials configured; skipped admin account seed.');
    return;
  }

  const passwordHash = await argon2.hash(config.ADMIN_PASSWORD, { type: argon2.argon2id });
  await inTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role)
       VALUES (lower($1), $2, 'admin')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [config.ADMIN_EMAIL, passwordHash]
    );
    if (!result.rows[0]) {
      console.log('Admin account already exists; no changes made.');
      return;
    }

    await client.query('INSERT INTO wallets (user_id, balance) VALUES ($1, 0)', [result.rows[0].id]);
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, after_data)
       VALUES ($1, 'admin_seeded', 'user', $2, jsonb_build_object('role', 'admin'))`,
      [result.rows[0].id, result.rows[0].id]
    );
  });
  console.log('Admin account seeded.');
}

seed()
  .catch((error: unknown) => {
    console.error('Database seed failed', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
