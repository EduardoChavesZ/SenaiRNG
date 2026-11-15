import { Router } from 'express';
import { z } from 'zod';
import { inTransaction } from '../db/transaction.js';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAdmin } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';

const router = Router();
const uuidSchema = z.string().uuid();
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const dailyRewardSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  currency: z.enum(['gold', 'gems', 'xp']),
  amount: z.number().int().positive().max(1_000_000_000),
  weight: z.number().int().positive().max(10_000),
  colorPrimary: colorSchema,
  colorSecondary: colorSchema,
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000)
});

const milestoneSchema = z.object({
  consecutiveDays: z.number().int().positive().max(3650),
  name: z.string().trim().min(1).max(80),
  currency: z.enum(['gold', 'gems', 'xp']),
  amount: z.number().int().positive().max(1_000_000_000),
  active: z.boolean()
});

const cosmeticSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  kind: z.enum(['avatar', 'banner', 'frame', 'effect', 'title']),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
  previewPrimary: colorSchema,
  previewSecondary: colorSchema,
  priceAmount: z.number().int().nonnegative().max(1_000_000_000),
  priceCurrency: z.enum(['gold', 'gems']),
  requiredLevel: z.number().int().min(1).max(100_000),
  requiredAchievementKey: z.string().trim().min(1).max(80).nullable(),
  active: z.boolean()
});

router.use(requireAdmin);

router.get('/daily-rewards', asyncHandler(async (_request, response) => {
  const [rewards, milestones] = await Promise.all([
    pool.query(
      `SELECT id, name, description, currency, amount::text, weight::text,
              color_primary, color_secondary, active, sort_order
       FROM daily_rewards ORDER BY sort_order, id`
    ),
    pool.query(
      `SELECT consecutive_days, name, currency, amount::text, active
       FROM daily_streak_milestones ORDER BY consecutive_days`
    )
  ]);
  response.json({ rewards: rewards.rows, milestones: milestones.rows });
}));

router.put('/daily-rewards', asyncHandler(async (request, response) => {
  const input = z.array(dailyRewardSchema).min(1).max(100).parse(request.body);
  const activeWeight = input.filter((reward) => reward.active)
    .reduce((sum, reward) => sum + reward.weight, 0);
  if (activeWeight !== 10_000) {
    throw new AppError('As probabilidades ativas da roleta devem totalizar exatamente 100%.', 400);
  }
  const ids = input.flatMap((reward) => reward.id ? [reward.id] : []);
  if (new Set(ids).size !== ids.length) throw new AppError('A lista contém recompensas repetidas.', 400);

  await inTransaction(async (client) => {
    const before = await client.query(
      `SELECT id, name, currency, amount::text, weight::text, active, sort_order
       FROM daily_rewards ORDER BY sort_order, id FOR UPDATE`
    );
    for (const reward of input) {
      if (reward.id) {
        const updated = await client.query(
          `UPDATE daily_rewards SET
             name = $2, description = $3, currency = $4, amount = $5, weight = $6,
             color_primary = $7, color_secondary = $8, active = $9, sort_order = $10,
             updated_at = now()
           WHERE id = $1`,
          [
            reward.id, reward.name, reward.description, reward.currency, reward.amount,
            reward.weight, reward.colorPrimary, reward.colorSecondary, reward.active,
            reward.sortOrder
          ]
        );
        if (updated.rowCount !== 1) throw new AppError('Uma recompensa não foi encontrada.', 404);
      } else {
        await client.query(
          `INSERT INTO daily_rewards
             (name, description, currency, amount, weight, color_primary, color_secondary, active, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            reward.name, reward.description, reward.currency, reward.amount, reward.weight,
            reward.colorPrimary, reward.colorSecondary, reward.active, reward.sortOrder
          ]
        );
      }
    }
    if (ids.length) {
      await client.query(
        `UPDATE daily_rewards SET active = false, updated_at = now()
         WHERE NOT (id = ANY($1::uuid[])) AND active = true`,
        [ids]
      );
    } else {
      await client.query('UPDATE daily_rewards SET active = false, updated_at = now() WHERE active = true');
    }
    await writeAudit(
      client, request.user!.id, 'daily_rewards_updated', 'daily_reward_config', null,
      before.rows, input
    );
  });
  response.json({ message: 'Recompensas diárias atualizadas.' });
}));

router.put('/daily-streaks', asyncHandler(async (request, response) => {
  const input = z.array(milestoneSchema).max(100).parse(request.body);
  const days = input.map((item) => item.consecutiveDays);
  if (new Set(days).size !== days.length) throw new AppError('A lista contém marcos de sequência repetidos.', 400);
  await inTransaction(async (client) => {
    const before = await client.query(
      `SELECT consecutive_days, name, currency, amount::text, active
       FROM daily_streak_milestones ORDER BY consecutive_days FOR UPDATE`
    );
    for (const milestone of input) {
      await client.query(
        `INSERT INTO daily_streak_milestones (consecutive_days, name, currency, amount, active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (consecutive_days) DO UPDATE SET
           name = EXCLUDED.name, currency = EXCLUDED.currency, amount = EXCLUDED.amount,
           active = EXCLUDED.active, updated_at = now()`,
        [
          milestone.consecutiveDays, milestone.name, milestone.currency,
          milestone.amount, milestone.active
        ]
      );
    }
    if (days.length) {
      await client.query(
        'DELETE FROM daily_streak_milestones WHERE NOT (consecutive_days = ANY($1::integer[]))',
        [days]
      );
    } else {
      await client.query('DELETE FROM daily_streak_milestones');
    }
    await writeAudit(
      client, request.user!.id, 'daily_streaks_updated', 'daily_streak_config', null,
      before.rows, input
    );
  });
  response.json({ message: 'Regras de sequência atualizadas.' });
}));

router.get('/cosmetics', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT id, slug, kind, name, description, preview_primary, preview_secondary,
            price_amount::text, price_currency, required_level, required_achievement_key,
            active, created_at, updated_at
     FROM cosmetic_items ORDER BY kind, name`
  );
  response.json({ cosmetics: result.rows });
}));

router.post('/cosmetics', asyncHandler(async (request, response) => {
  const input = cosmeticSchema.parse(request.body);
  const item = await inTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO cosmetic_items (
         slug, kind, name, description, preview_primary, preview_secondary,
         price_amount, price_currency, required_level, required_achievement_key, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        input.slug, input.kind, input.name, input.description,
        input.previewPrimary, input.previewSecondary, input.priceAmount,
        input.priceCurrency, input.requiredLevel, input.requiredAchievementKey, input.active
      ]
    );
    const id = result.rows[0]!.id;
    await writeAudit(client, request.user!.id, 'cosmetic_created', 'cosmetic_item', id, null, input);
    return id;
  });
  response.status(201).json({ id: item });
}));

router.put('/cosmetics/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  const input = cosmeticSchema.parse(request.body);
  await inTransaction(async (client) => {
    const before = await client.query(
      `SELECT * FROM cosmetic_items WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!before.rows[0]) throw new AppError('Item cosmético não encontrado.', 404);
    await client.query(
      `UPDATE cosmetic_items SET
         slug = $2, kind = $3, name = $4, description = $5,
         preview_primary = $6, preview_secondary = $7, price_amount = $8,
         price_currency = $9, required_level = $10, required_achievement_key = $11,
         active = $12, updated_at = now()
       WHERE id = $1`,
      [
        id, input.slug, input.kind, input.name, input.description,
        input.previewPrimary, input.previewSecondary, input.priceAmount,
        input.priceCurrency, input.requiredLevel, input.requiredAchievementKey, input.active
      ]
    );
    await writeAudit(client, request.user!.id, 'cosmetic_updated', 'cosmetic_item', id, before.rows[0], input);
  });
  response.json({ message: 'Item cosmético atualizado.' });
}));

router.delete('/cosmetics/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  await inTransaction(async (client) => {
    const before = await client.query(
      `SELECT * FROM cosmetic_items WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!before.rows[0]) throw new AppError('Item cosmético não encontrado.', 404);
    await client.query(
      'UPDATE cosmetic_items SET active = false, updated_at = now() WHERE id = $1',
      [id]
    );
    await writeAudit(
      client, request.user!.id, 'cosmetic_deactivated', 'cosmetic_item',
      id, before.rows[0], { ...before.rows[0], active: false }
    );
  });
  response.status(204).end();
}));

async function writeAudit(
  client: import('pg').PoolClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      actorId, action, entityType, entityId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after)
    ]
  );
}

export default router;
