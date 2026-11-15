import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { inTransaction } from '../db/transaction.js';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';
import { imageUpload, saveUploadedImage } from '../services/image-upload.js';
import { getSetting } from '../services/settings.js';
import {
  insertWalletTransaction,
  levelForXp,
  lockWallet,
  setWalletBalance,
  type SpendableCurrency
} from '../services/wallet.js';

const router = Router();
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const uuidOrNull = z.string().uuid().nullable();
const profileSchema = z.object({
  nickname: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_]+$/),
  description: z.string().trim().max(240),
  nicknameColor: colorSchema,
  colorPrimary: colorSchema,
  colorSecondary: colorSchema,
  theme: z.enum(['light', 'dark']),
  avatarItemId: uuidOrNull,
  bannerItemId: uuidOrNull,
  avatarImagePath: z.string().regex(/^\/uploads\/profiles\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i).nullable(),
  bannerImagePath: z.string().regex(/^\/uploads\/profiles\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i).nullable(),
  speechText: z.string().trim().max(120),
  frameItemId: uuidOrNull,
  titleItemId: uuidOrNull,
  featuredCardId: uuidOrNull
});
const preferencesSchema = z.object({
  reduceEffects: z.boolean().optional(),
  invocationMusicEnabled: z.boolean().optional(),
  soundVolume: z.number().min(0).max(1).optional()
}).strict().refine((preferences) => Object.keys(preferences).length > 0, {
  message: 'Informe ao menos uma preferência para atualizar.'
});
const purchaseSchema = z.object({ idempotencyKey: z.string().uuid() });

router.get('/public/:nickname', asyncHandler(async (request, response) => {
  const nickname = z.string().trim().min(3).max(20).parse(request.params.nickname);
  const profile = await loadPublicProfile(nickname);
  if (!profile) throw new AppError('Perfil não encontrado.', 404);
  response.json({ profile });
}));

router.get('/rankings', asyncHandler(async (request, response) => {
  const metric = z.enum(['cards', 'gold', 'level']).default('cards').parse(request.query.metric);
  const orderBy: Record<typeof metric, string> = {
    cards: 'COALESCE(collection.total_cards, 0)',
    gold: 'wallets.balance',
    level: 'wallets.xp_balance'
  };
  const xpPerLevel = await getSetting<number>('xp_per_level', 100);
  const result = await pool.query<{
    nickname: string;
    nickname_color: string;
    xp_balance: string;
    gold_balance: string;
    total_cards: string;
    rank: number;
  }>(
    `SELECT profile.nickname, profile.nickname_color, wallets.xp_balance::text, wallets.balance::text AS gold_balance,
            COALESCE(collection.total_cards, 0)::text AS total_cards,
            row_number() OVER (ORDER BY ${orderBy[metric]} DESC, profile.nickname ASC)::integer AS rank
     FROM users
     JOIN wallets ON wallets.user_id = users.id
     JOIN user_profile_customizations AS profile ON profile.user_id = users.id
     LEFT JOIN (
       SELECT user_id, SUM(quantity) AS total_cards
       FROM user_cards
       GROUP BY user_id
     ) AS collection ON collection.user_id = users.id
     WHERE users.deleted_at IS NULL
     ORDER BY ${orderBy[metric]} DESC, profile.nickname ASC
     LIMIT 20`
  );
  response.json({
    metric,
    rankings: result.rows.map((row) => ({
      nickname: row.nickname,
      nicknameColor: row.nickname_color,
      xp: Number(row.xp_balance),
      gold: Number(row.gold_balance),
      level: levelForXp(BigInt(row.xp_balance), xpPerLevel),
      cards: Number(row.total_cards),
      rank: row.rank
    }))
  });
}));

router.use(requireAuth);

router.post('/images/:kind', imageUpload.single('image'), asyncHandler(async (request, response) => {
  const kind = z.enum(['avatar', 'banner']).parse(request.params.kind);
  if (!request.file) throw new AppError('Selecione uma imagem para enviar.', 400);
  const image = await saveUploadedImage(request.file.buffer, request.user!.id);
  response.status(201).json({ kind, imagePath: image.imagePath });
}));

router.get('/me', asyncHandler(async (request, response) => {
  await ensureProfile(request.user!.id);
  const [profile, preferences, items, cards, achievements] = await Promise.all([
    loadOwnProfile(request.user!.id),
    loadPreferences(request.user!.id),
    loadCosmeticItems(request.user!.id),
    pool.query(
      `SELECT user_cards.card_id, cards.name, cards.image_path, rarities.name AS rarity_name,
              user_cards.quantity
       FROM user_cards
       JOIN cards ON cards.id = user_cards.card_id
       JOIN rarities ON rarities.id = cards.rarity_id
       WHERE user_cards.user_id = $1
       ORDER BY cards.name`,
      [request.user!.id]
    ),
    pool.query(
      `SELECT achievements.key, achievements.name, achievements.description, user_achievements.unlocked_at
       FROM user_achievements
       JOIN achievements ON achievements.id = user_achievements.achievement_id
       WHERE user_achievements.user_id = $1
       ORDER BY user_achievements.unlocked_at DESC`,
      [request.user!.id]
    )
  ]);
  response.json({ profile, preferences, cosmetics: items, cards: cards.rows, achievements: achievements.rows });
}));

router.put('/preferences', asyncHandler(async (request, response) => {
  const input = preferencesSchema.parse(request.body);
  const updated = await pool.query<{
    reduce_effects: boolean;
    invocation_music_enabled: boolean;
    sound_volume: number;
  }>(
    `INSERT INTO user_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET
       reduce_effects = COALESCE($2::boolean, user_preferences.reduce_effects),
       invocation_music_enabled = COALESCE($3::boolean, user_preferences.invocation_music_enabled),
       sound_volume = COALESCE($4::real, user_preferences.sound_volume),
       updated_at = now()
     RETURNING reduce_effects, invocation_music_enabled, sound_volume`,
    [
      request.user!.id,
      input.reduceEffects ?? null,
      input.invocationMusicEnabled ?? null,
      input.soundVolume ?? null
    ]
  );
  response.json({ preferences: mapPreferences(updated.rows[0]!) });
}));

router.put('/me', asyncHandler(async (request, response) => {
  const input = profileSchema.parse(request.body);
  const userImagePrefix = `/uploads/profiles/${request.user!.id}/`;
  if ([input.avatarImagePath, input.bannerImagePath].some((imagePath) =>
    imagePath !== null && !imagePath.startsWith(userImagePrefix)
  )) {
    throw new AppError('Use somente imagens enviadas para este perfil.', 403);
  }
  const profile = await inTransaction(async (client) => {
    const userId = request.user!.id;
    const currentResult = await client.query<{
      nickname: string;
      nickname_changed_at: Date;
    }>(
      `SELECT nickname, nickname_changed_at
       FROM user_profile_customizations WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    const current = currentResult.rows[0];
    if (!current) throw new AppError('O perfil não foi encontrado.', 404);
    const nicknameChanged = current.nickname.toLowerCase() !== input.nickname.toLowerCase();
    if (nicknameChanged) {
      const cooldownDays = await getSetting<number>('nickname_change_cooldown_days', 7, client);
      const lastChange = current.nickname_changed_at.getTime();
      if (Date.now() - lastChange < cooldownDays * 24 * 60 * 60 * 1000) {
        throw new AppError('O apelido ainda está no período de espera para alteração.', 409);
      }
      const duplicate = await client.query(
        `SELECT 1 FROM user_profile_customizations
         WHERE lower(nickname) = lower($1) AND user_id <> $2`,
        [input.nickname, userId]
      );
      if (duplicate.rowCount) throw new AppError('Esse apelido já está em uso.', 409);
    }

    const wallet = await lockWallet(client, userId);
    const xpPerLevel = await getSetting<number>('xp_per_level', 100, client);
    const level = levelForXp(wallet.xp, xpPerLevel);
    const equipped = [
      { id: input.avatarItemId, kind: 'avatar' },
      { id: input.bannerItemId, kind: 'banner' },
      { id: input.frameItemId, kind: 'frame' },
      { id: input.titleItemId, kind: 'title' }
    ];
    for (const item of equipped) {
      if (item.id) await ensureEquippableItem(client, userId, item.id, item.kind, level);
    }
    if (input.featuredCardId) {
      const ownedCard = await client.query(
        `SELECT 1 FROM user_cards WHERE user_id = $1 AND card_id = $2`,
        [userId, input.featuredCardId]
      );
      if (!ownedCard.rowCount) throw new AppError('Só é possível destacar cartas da sua coleção.', 403);
    }

    try {
      await client.query(
        `UPDATE user_profile_customizations SET
           nickname = $2, description = $3, color_primary = $4, color_secondary = $5,
           nickname_color = $6, theme = $7, avatar_item_id = $8, banner_item_id = $9,
           frame_item_id = $10, title_item_id = $11, featured_card_id = $12,
           avatar_image_path = $13, banner_image_path = $14, speech_text = $15,
           nickname_changed_at = CASE WHEN $16 THEN now() ELSE nickname_changed_at END,
           updated_at = now()
         WHERE user_id = $1`,
        [
          userId, input.nickname, input.description, input.colorPrimary, input.colorSecondary,
          input.nicknameColor, input.theme, input.avatarItemId, input.bannerItemId,
          input.frameItemId, input.titleItemId, input.featuredCardId,
          input.avatarImagePath, input.bannerImagePath, input.speechText, nicknameChanged
        ]
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('Esse apelido já está em uso.', 409);
      throw error;
    }
    return loadOwnProfile(userId, client);
  });
  response.json({ profile });
}));

router.post('/cosmetics/:id/purchase', asyncHandler(async (request, response) => {
  const itemId = z.string().uuid().parse(request.params.id);
  const { idempotencyKey } = purchaseSchema.parse(request.body);
  const purchase = await inTransaction(async (client) => {
    const replay = await client.query<{ item_id: string }>(
      `SELECT item_id FROM user_cosmetic_items
       WHERE user_id = $1 AND idempotency_key = $2`,
      [request.user!.id, idempotencyKey]
    );
    if (replay.rows[0]) {
      if (replay.rows[0].item_id !== itemId) {
        throw new AppError('A chave de solicitação já foi usada para outro item.', 409);
      }
      return { itemId, idempotentReplay: true };
    }

    const itemResult = await client.query<{
      name: string;
      price_amount: string;
      price_currency: SpendableCurrency;
      required_level: number;
      required_achievement_key: string | null;
      active: boolean;
    }>(
      `SELECT name, price_amount::text, price_currency, required_level,
              required_achievement_key, active
       FROM cosmetic_items WHERE id = $1 FOR UPDATE`,
      [itemId]
    );
    const item = itemResult.rows[0];
    if (!item || !item.active) throw new AppError('Esse item cosmético não está disponível.', 404);
    const retriedPurchase = await client.query<{ item_id: string }>(
      `SELECT item_id FROM user_cosmetic_items
       WHERE user_id = $1 AND idempotency_key = $2`,
      [request.user!.id, idempotencyKey]
    );
    if (retriedPurchase.rows[0]) {
      if (retriedPurchase.rows[0].item_id !== itemId) {
        throw new AppError('A chave de solicitação já foi usada para outro item.', 409);
      }
      return { itemId, idempotentReplay: true };
    }
    const owned = await client.query(
      'SELECT 1 FROM user_cosmetic_items WHERE user_id = $1 AND item_id = $2',
      [request.user!.id, itemId]
    );
    if (owned.rowCount) throw new AppError('Você já possui esse item.', 409);

    const wallet = await lockWallet(client, request.user!.id);
    const xpPerLevel = await getSetting<number>('xp_per_level', 100, client);
    if (levelForXp(wallet.xp, xpPerLevel) < item.required_level) {
      throw new AppError(`Este item exige o nível ${item.required_level}.`, 403);
    }
    if (item.required_achievement_key) {
      const achievement = await client.query(
        `SELECT 1 FROM user_achievements
         JOIN achievements ON achievements.id = user_achievements.achievement_id
         WHERE user_achievements.user_id = $1 AND achievements.key = $2`,
        [request.user!.id, item.required_achievement_key]
      );
      if (!achievement.rowCount) throw new AppError('Você ainda não desbloqueou o requisito deste item.', 403);
    }
    const price = BigInt(item.price_amount);
    const balance = wallet[item.price_currency];
    if (balance < price) throw new AppError(`Saldo insuficiente em ${item.price_currency === 'gold' ? 'moedas' : 'gemas'}.`, 409);
    if (price > 0n) {
      const next = balance - price;
      await setWalletBalance(client, request.user!.id, item.price_currency, next);
      await insertWalletTransaction(client, {
        userId: request.user!.id,
        type: 'cosmetic_purchase',
        currency: item.price_currency,
        amount: -price,
        balanceAfter: next,
        referenceType: 'cosmetic_item',
        referenceId: itemId
      });
    }
    await client.query(
      `INSERT INTO user_cosmetic_items (user_id, item_id, idempotency_key)
       VALUES ($1, $2, $3)`,
      [request.user!.id, itemId, idempotencyKey]
    );
    return { itemId, idempotentReplay: false };
  });
  response.json(purchase);
}));

async function ensureProfile(userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_profile_customizations (user_id, nickname)
     VALUES ($1::uuid, 'Jogador-' || substr($1::uuid::text, 1, 8))
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await pool.query(
    `INSERT INTO user_game_stats (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await pool.query(
    `INSERT INTO user_preferences (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function loadPreferences(userId: string) {
  const result = await pool.query<{
    reduce_effects: boolean;
    invocation_music_enabled: boolean;
    sound_volume: number;
  }>(
    `SELECT reduce_effects, invocation_music_enabled, sound_volume
     FROM user_preferences WHERE user_id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) throw new AppError('As preferências do usuário não foram encontradas.', 500);
  return mapPreferences(row);
}

function mapPreferences(preferences: {
  reduce_effects: boolean;
  invocation_music_enabled: boolean;
  sound_volume: number;
}) {
  return {
    reduceEffects: preferences.reduce_effects,
    invocationMusicEnabled: preferences.invocation_music_enabled,
    soundVolume: preferences.sound_volume
  };
}

async function loadOwnProfile(userId: string, client?: PoolClient) {
  const executor = client ?? pool;
  const [profileResult, walletResult, statsResult] = await Promise.all([
    executor.query(
      `SELECT profile.user_id, profile.nickname, profile.description, profile.nickname_color,
              profile.color_primary, profile.color_secondary, profile.theme,
              profile.avatar_image_path, profile.banner_image_path, profile.speech_text,
              profile.avatar_item_id, avatar.name AS avatar_name,
              avatar.preview_primary AS avatar_primary, avatar.preview_secondary AS avatar_secondary,
              profile.banner_item_id, banner.name AS banner_name,
              banner.preview_primary AS banner_primary, banner.preview_secondary AS banner_secondary,
              profile.frame_item_id, frame.name AS frame_name,
              frame.preview_primary AS frame_primary, frame.preview_secondary AS frame_secondary,
              profile.title_item_id, title.name AS title_name,
              profile.featured_card_id, cards.name AS featured_card_name, cards.image_path AS featured_card_image,
              profile.nickname_changed_at, profile.updated_at
       FROM user_profile_customizations AS profile
       LEFT JOIN cosmetic_items AS avatar ON avatar.id = profile.avatar_item_id
       LEFT JOIN cosmetic_items AS banner ON banner.id = profile.banner_item_id
       LEFT JOIN cosmetic_items AS frame ON frame.id = profile.frame_item_id
       LEFT JOIN cosmetic_items AS title ON title.id = profile.title_item_id
       LEFT JOIN cards ON cards.id = profile.featured_card_id
       WHERE profile.user_id = $1`,
      [userId]
    ),
    executor.query<{ xp_balance: string }>(
      'SELECT xp_balance::text FROM wallets WHERE user_id = $1',
      [userId]
    ),
    executor.query(
      'SELECT total_draws::text, unique_cards, draws_by_rarity FROM user_game_stats WHERE user_id = $1',
      [userId]
    )
  ]);
  const row = profileResult.rows[0];
  if (!row) throw new AppError('O perfil não foi encontrado.', 404);
  const xp = BigInt(walletResult.rows[0]?.xp_balance ?? '0');
  const xpPerLevel = client
    ? await getSetting<number>('xp_per_level', 100, client)
    : await getSetting<number>('xp_per_level', 100);
  return {
    id: row.user_id,
    nickname: row.nickname,
    description: row.description,
    nicknameColor: row.nickname_color,
    colorPrimary: row.color_primary,
    colorSecondary: row.color_secondary,
    theme: row.theme,
    avatarImagePath: row.avatar_image_path,
    bannerImagePath: row.banner_image_path,
    speechText: row.speech_text,
    avatarItemId: row.avatar_item_id,
    avatar: row.avatar_name ? {
      name: row.avatar_name, colorPrimary: row.avatar_primary, colorSecondary: row.avatar_secondary
    } : null,
    bannerItemId: row.banner_item_id,
    banner: row.banner_name ? {
      name: row.banner_name, colorPrimary: row.banner_primary, colorSecondary: row.banner_secondary
    } : null,
    frameItemId: row.frame_item_id,
    frame: row.frame_name ? {
      name: row.frame_name, colorPrimary: row.frame_primary, colorSecondary: row.frame_secondary
    } : null,
    titleItemId: row.title_item_id,
    title: row.title_name,
    featuredCardId: row.featured_card_id,
    featuredCard: row.featured_card_name ? {
      name: row.featured_card_name, imagePath: row.featured_card_image
    } : null,
    nicknameChangedAt: row.nickname_changed_at,
    updatedAt: row.updated_at,
    xp: Number(xp),
    level: levelForXp(xp, xpPerLevel),
    stats: statsResult.rows[0] ?? { total_draws: '0', unique_cards: 0, draws_by_rarity: {} }
  };
}

async function loadCosmeticItems(userId: string) {
  const xpPerLevel = await getSetting<number>('xp_per_level', 100);
  const wallet = await pool.query<{ xp_balance: string }>(
    'SELECT xp_balance::text FROM wallets WHERE user_id = $1',
    [userId]
  );
  const level = levelForXp(BigInt(wallet.rows[0]?.xp_balance ?? '0'), xpPerLevel);
  const result = await pool.query<{
    id: string;
    slug: string;
    kind: string;
    name: string;
    description: string;
    preview_primary: string;
    preview_secondary: string;
    price_amount: string;
    price_currency: SpendableCurrency;
    required_level: number;
    required_achievement_key: string | null;
    active: boolean;
    owned: boolean;
    achievement_unlocked: boolean;
  }>(
    `SELECT items.id, items.slug, items.kind, items.name, items.description,
            items.preview_primary, items.preview_secondary, items.price_amount::text,
            items.price_currency, items.required_level, items.required_achievement_key, items.active,
            EXISTS (
              SELECT 1 FROM user_cosmetic_items owned
              WHERE owned.user_id = $1 AND owned.item_id = items.id
            ) AS owned,
            (items.required_achievement_key IS NULL OR EXISTS (
              SELECT 1 FROM user_achievements unlocked
              JOIN achievements ON achievements.id = unlocked.achievement_id
              WHERE unlocked.user_id = $1 AND achievements.key = items.required_achievement_key
            )) AS achievement_unlocked
     FROM cosmetic_items items
     WHERE items.active = true
     ORDER BY items.kind, items.required_level, items.price_amount, items.name`,
    [userId]
  );
  return result.rows.map((item) => {
    const requirementsMet = level >= item.required_level && item.achievement_unlocked;
    return {
      id: item.id,
      slug: item.slug,
      kind: item.kind,
      name: item.name,
      description: item.description,
      previewPrimary: item.preview_primary,
      previewSecondary: item.preview_secondary,
      priceAmount: Number(item.price_amount),
      priceCurrency: item.price_currency,
      requiredLevel: item.required_level,
      requiredAchievementKey: item.required_achievement_key,
      owned: item.owned,
      requirementsMet,
      canPurchase: !item.owned && requirementsMet,
      canEquip: item.owned
    };
  });
}

async function ensureEquippableItem(
  client: import('pg').PoolClient,
  userId: string,
  itemId: string,
  kind: string,
  level: number
): Promise<void> {
  const result = await client.query<{
    required_level: number;
    required_achievement_key: string | null;
  }>(
    `SELECT items.required_level, items.required_achievement_key
     FROM cosmetic_items items
     JOIN user_cosmetic_items owned ON owned.item_id = items.id AND owned.user_id = $1
     WHERE items.id = $2 AND items.kind = $3`,
    [userId, itemId, kind]
  );
  if (!result.rows[0]) throw new AppError(`O item selecionado não pertence à sua coleção de ${kind}.`, 403);
  const item = result.rows[0];
  if (level < item.required_level) throw new AppError('O nível atual não permite equipar este item.', 403);
  if (item.required_achievement_key) {
    const unlocked = await client.query(
      `SELECT 1 FROM user_achievements
       JOIN achievements ON achievements.id = user_achievements.achievement_id
       WHERE user_achievements.user_id = $1 AND achievements.key = $2`,
      [userId, item.required_achievement_key]
    );
    if (!unlocked.rowCount) throw new AppError('O título ainda não foi desbloqueado.', 403);
  }
}

async function loadPublicProfile(nickname: string) {
  const result = await pool.query<{
    user_id: string;
    nickname: string;
    description: string;
    nickname_color: string;
    color_primary: string;
    color_secondary: string;
    theme: string;
    avatar_image_path: string | null;
    banner_image_path: string | null;
    speech_text: string;
    avatar_name: string | null;
    avatar_primary: string | null;
    avatar_secondary: string | null;
    banner_name: string | null;
    banner_primary: string | null;
    banner_secondary: string | null;
    frame_name: string | null;
    frame_primary: string | null;
    frame_secondary: string | null;
    title_name: string | null;
    featured_card_name: string | null;
    featured_card_image: string | null;
    xp_balance: string;
    total_draws: string;
    unique_cards: number;
  }>(
    `SELECT profile.user_id, profile.nickname, profile.description, profile.nickname_color,
            profile.color_primary, profile.color_secondary, profile.theme,
            profile.avatar_image_path, profile.banner_image_path, profile.speech_text,
            avatar.name AS avatar_name, avatar.preview_primary AS avatar_primary,
            avatar.preview_secondary AS avatar_secondary,
            banner.name AS banner_name, banner.preview_primary AS banner_primary,
            banner.preview_secondary AS banner_secondary,
            frame.name AS frame_name, frame.preview_primary AS frame_primary,
            frame.preview_secondary AS frame_secondary, title.name AS title_name,
            cards.name AS featured_card_name, cards.image_path AS featured_card_image,
            wallets.xp_balance::text, stats.total_draws::text, stats.unique_cards
     FROM user_profile_customizations AS profile
     JOIN users ON users.id = profile.user_id AND users.deleted_at IS NULL
     JOIN wallets ON wallets.user_id = profile.user_id
     LEFT JOIN user_game_stats AS stats ON stats.user_id = profile.user_id
     LEFT JOIN cosmetic_items AS avatar ON avatar.id = profile.avatar_item_id
     LEFT JOIN cosmetic_items AS banner ON banner.id = profile.banner_item_id
     LEFT JOIN cosmetic_items AS frame ON frame.id = profile.frame_item_id
     LEFT JOIN cosmetic_items AS title ON title.id = profile.title_item_id
     LEFT JOIN cards ON cards.id = profile.featured_card_id
     WHERE lower(profile.nickname) = lower($1)`,
    [nickname]
  );
  const row = result.rows[0];
  if (!row) return null;
  const xpPerLevel = await getSetting<number>('xp_per_level', 100);
  return {
    nickname: row.nickname,
    description: row.description,
    nicknameColor: row.nickname_color,
    colorPrimary: row.color_primary,
    colorSecondary: row.color_secondary,
    theme: row.theme,
    avatarImagePath: row.avatar_image_path,
    bannerImagePath: row.banner_image_path,
    speechText: row.speech_text,
    avatar: row.avatar_name ? {
      name: row.avatar_name, colorPrimary: row.avatar_primary, colorSecondary: row.avatar_secondary
    } : null,
    banner: row.banner_name ? {
      name: row.banner_name, colorPrimary: row.banner_primary, colorSecondary: row.banner_secondary
    } : null,
    frame: row.frame_name ? {
      name: row.frame_name, colorPrimary: row.frame_primary, colorSecondary: row.frame_secondary
    } : null,
    title: row.title_name,
    featuredCard: row.featured_card_name ? {
      name: row.featured_card_name, imagePath: row.featured_card_image
    } : null,
    xp: Number(row.xp_balance),
    level: levelForXp(BigInt(row.xp_balance), xpPerLevel),
    stats: { totalDraws: Number(row.total_draws), uniqueCards: row.unique_cards }
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export default router;
