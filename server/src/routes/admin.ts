import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  cardImageUpload,
  inspectSavedImage,
  saveUploadedImage,
  staticImageMimeTypes
} from '../services/image-upload.js';
import { z } from 'zod';
import { inTransaction } from '../db/transaction.js';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAdmin } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';
import { loadAllCardProbabilities } from '../services/probabilities.js';
import { getSetting, setSetting } from '../services/settings.js';
import { insertWalletTransaction, lockWallet, setWalletBalance } from '../services/wallet.js';
import { parseYouTubeVideoId } from '../services/youtube.js';
import {
  assertAffectedBannersRemainValid,
  assertCardRarityCompatible,
  assertRarityTierCompatible
} from '../services/invocation-config.js';

const router = Router();
router.use(requireAdmin);

const nameSchema = z.string().trim().min(1).max(100);
const uuidSchema = z.string().uuid();
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const raritySchema = z.object({
  name: nameSchema,
  colorPrimary: colorSchema,
  colorSecondary: colorSchema,
  visualEffect: z.string().trim().min(1).max(40),
  animationLevel: z.number().int().min(1).max(6),
  sortOrder: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  weight: z.number().safe().positive().max(9_000_000_000_000_000),
  duplicateTier: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary', 'secret']),
  active: z.boolean()
});
const categorySchema = z.object({ name: nameSchema, active: z.boolean() });
const cardSchema = z.object({
  name: nameSchema,
  imagePath: z.string().regex(/^\/uploads\/[0-9a-f-]+\.(jpg|png|webp)$/i).nullable().default(null),
  description: z.string().max(2000).default(''),
  categoryId: uuidSchema.nullable(),
  rarityId: uuidSchema,
  weight: z.number().safe().positive().max(9_000_000_000_000_000),
  musicUrl: z.string().trim().max(2048).nullable().default(null),
  musicRightsConfirmed: z.boolean().default(false),
  active: z.boolean()
}).superRefine((value, context) => {
  if (value.musicUrl && !value.musicRightsConfirmed) {
    context.addIssue({ code: 'custom', message: 'Confirme que possui autorização para incorporar esta música.' });
  }
});
const settingsSchema = z.object({
  drawCostGold: z.number().safe().positive().max(1_000_000_000),
  drawCostGems: z.number().safe().positive().max(1_000_000_000),
  drawCurrency: z.enum(['gold', 'gems']),
  drawEventEnabled: z.boolean(),
  drawEventDiscountPercent: z.number().int().min(0).max(99),
  drawEventStartsAt: z.string().datetime().nullable(),
  drawEventEndsAt: z.string().datetime().nullable(),
  signupBonus: z.number().safe().nonnegative().max(1_000_000_000),
  xpPerDraw: z.number().int().nonnegative().max(1_000_000_000),
  distributionMode: z.enum(['individual', 'rarity']),
  rarityCardSelection: z.enum(['equal', 'weighted']),
  drawMaxQuantity: z.number().int().min(1).max(10),
  loginMusicUrl: z.string().trim().max(2048),
  loginMusicRightsConfirmed: z.boolean()
}).superRefine((value, context) => {
  if ((value.drawEventStartsAt === null) !== (value.drawEventEndsAt === null)) {
    context.addIssue({ code: 'custom', message: 'Informe início e fim do evento ou deixe ambos vazios.' });
  }
  if (value.drawEventStartsAt && value.drawEventEndsAt
    && new Date(value.drawEventStartsAt).getTime() >= new Date(value.drawEventEndsAt).getTime()) {
    context.addIssue({ code: 'custom', message: 'O fim do evento precisa ser posterior ao início.' });
  }
  if (value.loginMusicUrl && !value.loginMusicRightsConfirmed) {
    context.addIssue({ code: 'custom', message: 'Confirme que possui autorização para incorporar a música da página de acesso.' });
  }
});
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
    [actorId, action, entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
  );
}

router.get('/rarities', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT id, name, color_primary, color_secondary, visual_effect, animation_level,
            sort_order, weight, duplicate_tier, active, deleted_at
     FROM rarities ORDER BY sort_order, name`
  );
  response.json({ rarities: result.rows });
}));

router.put('/cards/:id/weight', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  const { weight } = z.object({
    weight: z.number().safe().positive().max(9_000_000_000_000_000)
  }).parse(request.body);
  const card = await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM cards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Carta não encontrada.', 404);
    const result = await client.query(
      'UPDATE cards SET weight = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [id, weight]
    );
    await writeAudit(client, request.user!.id, 'card_weight_updated', 'card', id,
      { weight: current.rows[0].weight }, { weight: result.rows[0].weight });
    return result.rows[0];
  });
  response.json({ card });
}));

router.post('/rarities', asyncHandler(async (request, response) => {
  const input = raritySchema.parse(request.body);
  const result = await inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO rarities (name, color_primary, color_secondary, visual_effect,
                             animation_level, sort_order, weight, duplicate_tier, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [input.name, input.colorPrimary, input.colorSecondary, input.visualEffect,
        input.animationLevel, input.sortOrder, input.weight, input.duplicateTier, input.active]
    );
    const rarity = inserted.rows[0];
    await writeAudit(client, request.user!.id, 'rarity_created', 'rarity', rarity.id, null, rarity);
    return rarity;
  });
  response.status(201).json({ rarity: result });
}));

router.put('/rarities/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  const input = raritySchema.parse(request.body);
  const rarity = await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM rarities WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Raridade não encontrada.', 404);
    const result = await client.query(
      `UPDATE rarities SET name = $2, color_primary = $3, color_secondary = $4,
       visual_effect = $5, animation_level = $6, sort_order = $7, weight = $8,
       duplicate_tier = $9, active = $10
       WHERE id = $1 RETURNING *`,
      [id, input.name, input.colorPrimary, input.colorSecondary, input.visualEffect,
        input.animationLevel, input.sortOrder, input.weight, input.duplicateTier, input.active]
    );
    await assertRarityTierCompatible(client, id, input.duplicateTier);
    await assertAffectedBannersRemainValid(client, undefined, id);
    await writeAudit(client, request.user!.id, 'rarity_updated', 'rarity', id, current.rows[0], result.rows[0]);
    return result.rows[0];
  });
  response.json({ rarity });
}));

router.delete('/rarities/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM rarities WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Raridade não encontrada.', 404);
    const linked = await client.query(
      'SELECT 1 FROM cards WHERE rarity_id = $1 AND active = true AND deleted_at IS NULL LIMIT 1',
      [id]
    );
    if (linked.rowCount) throw new AppError('Desative ou mova as cartas ativas desta raridade antes de removê-la.', 409);
    const result = await client.query('UPDATE rarities SET active = false, deleted_at = now() WHERE id = $1 RETURNING *', [id]);
    await writeAudit(client, request.user!.id, 'rarity_deleted', 'rarity', id, current.rows[0], result.rows[0]);
  });
  response.status(204).end();
}));

router.get('/categories', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    'SELECT id, name, active, deleted_at FROM categories ORDER BY name'
  );
  response.json({ categories: result.rows });
}));

router.post('/categories', asyncHandler(async (request, response) => {
  const input = categorySchema.parse(request.body);
  const category = await inTransaction(async (client) => {
    const result = await client.query(
      'INSERT INTO categories (name, active) VALUES ($1, $2) RETURNING *',
      [input.name, input.active]
    );
    await writeAudit(client, request.user!.id, 'category_created', 'category', result.rows[0].id, null, result.rows[0]);
    return result.rows[0];
  });
  response.status(201).json({ category });
}));

router.put('/categories/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  const input = categorySchema.parse(request.body);
  const category = await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM categories WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Categoria não encontrada.', 404);
    const result = await client.query(
      'UPDATE categories SET name = $2, active = $3 WHERE id = $1 RETURNING *',
      [id, input.name, input.active]
    );
    await writeAudit(client, request.user!.id, 'category_updated', 'category', id, current.rows[0], result.rows[0]);
    return result.rows[0];
  });
  response.json({ category });
}));

router.delete('/categories/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM categories WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Categoria não encontrada.', 404);
    const result = await client.query('UPDATE categories SET active = false, deleted_at = now() WHERE id = $1 RETURNING *', [id]);
    await writeAudit(client, request.user!.id, 'category_deleted', 'category', id, current.rows[0], result.rows[0]);
  });
  response.status(204).end();
}));

router.get('/cards', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT cards.*, categories.name AS category_name, rarities.name AS rarity_name
     FROM cards
     JOIN rarities ON rarities.id = cards.rarity_id
     LEFT JOIN categories ON categories.id = cards.category_id
     ORDER BY cards.created_at DESC`
  );
  response.json({ cards: result.rows });
}));

router.get('/overview', asyncHandler(async (_request, response) => {
  const [users, cards, draws] = await Promise.all([
    pool.query<{ count: string }>('SELECT count(*) FROM users WHERE deleted_at IS NULL'),
    pool.query<{ total: string; active: string }>(
      `SELECT count(*) AS total,
        count(*) FILTER (WHERE active = true AND deleted_at IS NULL) AS active
       FROM cards`
    ),
    pool.query<{ count: string }>('SELECT count(*) FROM draws')
  ]);
  response.json({
    users: Number(users.rows[0]!.count),
    cards: {
      total: Number(cards.rows[0]!.total),
      active: Number(cards.rows[0]!.active)
    },
    draws: Number(draws.rows[0]!.count)
  });
}));

router.get('/users', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT users.id, users.email, users.role, wallets.balance,
            wallets.gems_balance, wallets.xp_balance
     FROM users JOIN wallets ON wallets.user_id = users.id
     WHERE users.deleted_at IS NULL ORDER BY users.created_at DESC LIMIT 200`
  );
  response.json({ users: result.rows });
}));

router.get('/draws', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT draws.*, users.email AS user_email
     FROM draws JOIN users ON users.id = draws.user_id
     ORDER BY draws.created_at DESC LIMIT 200`
  );
  response.json({ draws: result.rows });
}));

router.get('/daily-history', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT history.id, history.user_id, users.email AS user_email, history.claim_date::text,
            history.reward_name, history.currency, history.amount::text, history.streak_days,
            history.streak_bonus_name, history.streak_bonus_currency,
            history.streak_bonus_amount::text, history.created_at
     FROM daily_reward_history AS history
     JOIN users ON users.id = history.user_id
     ORDER BY history.created_at DESC, history.id DESC LIMIT 200`
  );
  response.json({ claims: result.rows });
}));

router.get('/wallet-history', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT transactions.id, transactions.user_id, users.email AS user_email,
            transactions.type, transactions.currency, transactions.amount::text,
            transactions.balance_after::text, transactions.reference_type,
            transactions.reference_id, transactions.created_at
     FROM wallet_transactions AS transactions
     JOIN users ON users.id = transactions.user_id
     ORDER BY transactions.created_at DESC, transactions.id DESC LIMIT 200`
  );
  response.json({ transactions: result.rows });
}));

router.post('/cards', asyncHandler(async (request, response) => {
  const input = cardSchema.parse(request.body);
  if (input.active && !input.imagePath) {
    throw new AppError('Adicione uma imagem antes de publicar uma nova carta.', 400);
  }
  const image = input.imagePath
    ? await inspectSavedImage(input.imagePath, staticImageMimeTypes)
    : null;
  const youtubeVideoId = parseMusicUrl(input.musicUrl);
  const card = await inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO cards (name, image_path, image_mime_type, image_width, image_height,
                          description, category_id, rarity_id, weight, youtube_video_id,
                          youtube_authorized_at, youtube_authorized_by, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN $10::text IS NULL THEN NULL ELSE now() END,
               CASE WHEN $10::text IS NULL THEN NULL ELSE $11::uuid END, $12)
       RETURNING *`,
      [input.name, input.imagePath, image?.mime ?? null, image?.width ?? null, image?.height ?? null,
        input.description, input.categoryId, input.rarityId, input.weight, youtubeVideoId,
        request.user!.id, input.active]
    );
    await writeAudit(client, request.user!.id, 'card_created', 'card', result.rows[0].id, null, result.rows[0]);
    return result.rows[0];
  });
  response.status(201).json({ card });
}));

router.put('/cards/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  const input = cardSchema.parse(request.body);
  const youtubeVideoId = parseMusicUrl(input.musicUrl);
  const card = await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM cards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Carta não encontrada.', 404);
    if (input.active && !input.imagePath && !current.rows[0].active) {
      throw new AppError('Adicione uma imagem antes de publicar uma nova carta.', 400);
    }
    if (input.active && current.rows[0].image_path && !input.imagePath) {
      throw new AppError('Desative a carta antes de remover sua imagem.', 400);
    }
    const image = input.imagePath && input.imagePath !== current.rows[0].image_path
      ? await inspectSavedImage(input.imagePath, staticImageMimeTypes)
      : input.imagePath
        ? {
          mime: current.rows[0].image_mime_type,
          width: current.rows[0].image_width,
          height: current.rows[0].image_height
        }
        : null;
    const result = await client.query(
      `UPDATE cards SET name = $2, image_path = $3, image_mime_type = $4, image_width = $5,
       image_height = $6, description = $7, category_id = $8, rarity_id = $9,
       weight = $10, youtube_video_id = $11,
       youtube_authorized_at = CASE WHEN $11::text IS NULL THEN NULL ELSE now() END,
       youtube_authorized_by = CASE WHEN $11::text IS NULL THEN NULL ELSE $12::uuid END,
       active = $13, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.name, input.imagePath, image?.mime ?? null, image?.width ?? null, image?.height ?? null,
        input.description, input.categoryId, input.rarityId, input.weight, youtubeVideoId,
        request.user!.id, input.active]
    );
    await assertCardRarityCompatible(client, id, input.rarityId);
    await assertAffectedBannersRemainValid(client, id);
    await writeAudit(client, request.user!.id, 'card_updated', 'card', id, current.rows[0], result.rows[0]);
    return result.rows[0];
  });
  response.json({ card });
}));

router.delete('/cards/:id', asyncHandler(async (request, response) => {
  const id = uuidSchema.parse(request.params.id);
  await inTransaction(async (client) => {
    const current = await client.query('SELECT * FROM cards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
    if (!current.rows[0]) throw new AppError('Carta não encontrada.', 404);
    const result = await client.query('UPDATE cards SET active = false, deleted_at = now() WHERE id = $1 RETURNING *', [id]);
    await assertAffectedBannersRemainValid(client, id);
    await writeAudit(client, request.user!.id, 'card_deleted', 'card', id, current.rows[0], result.rows[0]);
  });
  response.status(204).end();
}));

router.get('/probabilities', asyncHandler(async (_request, response) => {
  const [cards, mode, selection] = await Promise.all([
    loadAllCardProbabilities(),
    getSetting('distribution_mode', 'individual'),
    getSetting('rarity_card_selection', 'equal')
  ]);
  response.json({ mode, rarityCardSelection: selection, cards });
}));

router.get('/settings', asyncHandler(async (_request, response) => {
  const [drawCostGold, drawCostGems, drawCurrency, drawEventEnabled,
    drawEventDiscountPercent, drawEventStartsAt, drawEventEndsAt, signupBonus,
    xpPerDraw, distributionMode, rarityCardSelection, drawMaxQuantity, loginMusic] = await Promise.all([
    getSetting('draw_cost_gold', 10),
    getSetting('draw_cost_gems', 1),
    getSetting<'gold' | 'gems'>('draw_currency', 'gold'),
    getSetting('draw_event_enabled', false),
    getSetting('draw_event_discount_percent', 0),
    getSetting<string | null>('draw_event_starts_at', null),
    getSetting<string | null>('draw_event_ends_at', null),
    getSetting('signup_bonus', 100),
    getSetting('xp_per_draw', 0),
    getSetting('distribution_mode', 'individual'),
    getSetting('rarity_card_selection', 'equal'),
    getSetting('draw_max_quantity', 10),
    getSetting<{ videoId: string; authorizedAt: string; authorizedBy: string } | null>('login_music', null)
  ]);
  const loginMusicVideoId = loginMusic
    && /^[A-Za-z0-9_-]{11}$/.test(loginMusic.videoId)
    && loginMusic.authorizedAt
    && loginMusic.authorizedBy
    ? loginMusic.videoId
    : null;
  response.json({
    settings: {
      drawCostGold, drawCostGems, drawCurrency, drawEventEnabled,
      drawEventDiscountPercent, drawEventStartsAt, drawEventEndsAt,
      signupBonus, xpPerDraw, distributionMode,
      rarityCardSelection, drawMaxQuantity,
      loginMusicUrl: loginMusicVideoId ? `https://www.youtube.com/watch?v=${loginMusicVideoId}` : '',
      loginMusicRightsConfirmed: Boolean(loginMusicVideoId) }
  });
}));

router.put('/settings', asyncHandler(async (request, response) => {
  const input = settingsSchema.parse(request.body);
  const loginMusicVideoId = parseMusicUrl(input.loginMusicUrl || null);
  const loginMusic = loginMusicVideoId
    ? { videoId: loginMusicVideoId, authorizedAt: new Date().toISOString(), authorizedBy: request.user!.id }
    : null;
  await inTransaction(async (client) => {
    const keys = [
      'draw_cost_gold', 'draw_cost_gems', 'draw_currency', 'draw_event_enabled',
      'draw_event_discount_percent', 'draw_event_starts_at', 'draw_event_ends_at',
      'signup_bonus', 'xp_per_draw', 'distribution_mode', 'rarity_card_selection',
      'draw_max_quantity', 'login_music'
    ] as const;
    const before = await client.query(
      'SELECT key, value FROM settings WHERE key = ANY($1::text[]) ORDER BY key FOR UPDATE',
      [keys]
    );
    const values = [
      input.drawCostGold, input.drawCostGems, input.drawCurrency, input.drawEventEnabled,
      input.drawEventDiscountPercent, input.drawEventStartsAt, input.drawEventEndsAt,
      input.signupBonus, input.xpPerDraw, input.distributionMode,
      input.rarityCardSelection, input.drawMaxQuantity, loginMusic
    ];
    for (let index = 0; index < keys.length; index += 1) {
      await setSetting(keys[index]!, values[index], client);
    }
    await writeAudit(client, request.user!.id, 'settings_updated', 'settings', null, before.rows, {
      ...input,
      loginMusicUrl: loginMusicVideoId ? `https://www.youtube.com/watch?v=${loginMusicVideoId}` : ''
    });
  });
  response.json({ settings: input });
}));

router.get('/audit-logs', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT audit_logs.*, users.email AS actor_email
     FROM audit_logs LEFT JOIN users ON users.id = audit_logs.actor_user_id
     ORDER BY audit_logs.created_at DESC LIMIT 200`
  );
  response.json({ logs: result.rows });
}));

router.post('/users/:id/wallet', asyncHandler(async (request, response) => {
  const userId = uuidSchema.parse(request.params.id);
  const input = z.object({
    amount: z.number().int().refine((value) => value !== 0 && Math.abs(value) <= 1_000_000_000),
    currency: z.enum(['gold', 'gems', 'xp']),
    reason: z.string().trim().min(1).max(250)
  }).parse(request.body);
  const result = await inTransaction(async (client) => {
    const wallet = await lockWallet(client, userId);
    const previous = wallet[input.currency];
    const balance = previous + BigInt(input.amount);
    if (balance < 0n) throw new AppError('O ajuste deixaria o saldo negativo.', 409);
    await setWalletBalance(client, userId, input.currency, balance);
    await insertWalletTransaction(client, {
      userId,
      type: input.amount > 0 ? 'admin_grant' : 'admin_adjustment',
      currency: input.currency,
      amount: BigInt(input.amount),
      balanceAfter: balance,
      referenceType: 'admin',
      referenceId: randomUUID()
    });
    await writeAudit(client, request.user!.id, 'wallet_adjusted', 'wallet', userId,
      { currency: input.currency, balance: previous.toString() },
      { currency: input.currency, balance: balance.toString(), amount: input.amount, reason: input.reason });
    return { balance: Number(balance), previous: Number(previous), currency: input.currency };
  });
  response.json(result);
}));

router.post('/uploads', cardImageUpload.single('image'), asyncHandler(async (request, response) => {
  if (!request.file) throw new AppError('Selecione uma imagem para enviar.', 400);
  const image = await saveUploadedImage(request.file.buffer, undefined, {
    allowedMimeTypes: staticImageMimeTypes,
    declaredMimeType: request.file.mimetype,
    originalName: request.file.originalname
  });
  await inTransaction(async (client) => {
    await writeAudit(client, request.user!.id, 'image_uploaded', 'image', image.filename, null, {
      mime: image.mime,
      bytes: image.bytes,
      width: image.width,
      height: image.height
    });
  });
  response.status(201).json({
    imagePath: image.imagePath,
    mimeType: image.mime,
    width: image.width,
    height: image.height,
    bytes: image.bytes
  });
}));

export default router;

function parseMusicUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return parseYouTubeVideoId(value);
  } catch (cause) {
    throw new AppError(cause instanceof Error ? cause.message : 'A URL do YouTube é inválida.', 400);
  }
}
