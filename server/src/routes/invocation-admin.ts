import { Router } from 'express';
import { z } from 'zod';
import { inTransaction } from '../db/transaction.js';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAdmin } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';
import { assertBannerConfiguration, assertDuplicateRewardPolicy } from '../services/invocation-config.js';
import { calculateCardProbabilities, type EligibleCard } from '../services/distribution.js';
import { calculateInvocationOdds, toNumber, type PityRule } from '../services/invocation.js';
import {
  allImageMimeTypes,
  bannerImageUpload,
  inspectSavedImage,
  saveUploadedImage,
  staticImageMimeTypes
} from '../services/image-upload.js';

const router = Router();
const uuid = z.string().uuid();
const positiveAmount = z.number().int().min(0).max(1_000_000_000);
const pitySchema = z.object({
  rarityId: uuid,
  softPityStart: z.number().int().min(1).max(32767).nullable(),
  softPityIncrementBps: z.number().int().min(0).max(10000),
  hardPityLimit: z.number().int().min(1).max(32767).nullable()
}).superRefine((value, context) => {
  if (value.softPityStart === null && value.softPityIncrementBps !== 0) {
    context.addIssue({ code: 'custom', message: 'Informe a posição do soft pity ou zere o incremento.' });
  }
  if (value.softPityStart !== null && value.softPityIncrementBps === 0) {
    context.addIssue({ code: 'custom', message: 'O incremento do soft pity precisa ser maior que zero.' });
  }
  if (value.softPityStart === null && value.hardPityLimit === null) {
    context.addIssue({ code: 'custom', message: 'Configure soft pity, hard pity ou ambos.' });
  }
  if (value.softPityStart !== null && value.hardPityLimit !== null
    && value.softPityStart >= value.hardPityLimit) {
    context.addIssue({ code: 'custom', message: 'O soft pity precisa começar antes do hard pity.' });
  }
});
const bannerSchema = z.object({
  version: z.number().int().positive().optional(),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000),
  active: z.boolean(),
  startsAt: z.string().datetime().nullable(),
  endsAt: z.string().datetime().nullable(),
  timeZone: z.string().trim().min(1).max(100),
  currency: z.enum(['gold', 'gems']),
  unitCost: z.number().int().positive().max(1_000_000_000),
  imagePath: z.string().regex(/^\/uploads\/[0-9a-f-]+\.(jpg|png|webp|gif)$/i).nullable().default(null),
  imageMimeType: z.enum(allImageMimeTypes).nullable().default(null),
  imageWidth: z.number().int().positive().max(16_384).nullable().default(null),
  imageHeight: z.number().int().positive().max(16_384).nullable().default(null),
  fallbackImagePath: z.string().regex(/^\/uploads\/[0-9a-f-]+\.(jpg|png|webp)$/i).nullable().default(null),
  fallbackImageMimeType: z.enum(staticImageMimeTypes).nullable().default(null),
  fallbackImageWidth: z.number().int().positive().max(16_384).nullable().default(null),
  fallbackImageHeight: z.number().int().positive().max(16_384).nullable().default(null),
  imageFocalX: z.number().int().min(0).max(100).default(50),
  imageFocalY: z.number().int().min(0).max(100).default(50),
  quantityOptions: z.array(z.number().int().min(1).max(10)).min(2).max(10),
  distributionMode: z.enum(['individual', 'rarity']),
  rarityCardSelection: z.enum(['equal', 'weighted']),
  pool: z.array(z.object({
    cardId: uuid,
    weight: z.number().int().positive().max(9_000_000_000_000_000),
    active: z.boolean()
  })).max(500),
  pity: pitySchema.nullable()
}).superRefine((value, context) => {
  if (value.startsAt && value.endsAt && new Date(value.startsAt) >= new Date(value.endsAt)) {
    context.addIssue({ code: 'custom', message: 'O encerramento precisa ser posterior ao início.' });
  }
  if (!value.quantityOptions.includes(1) || !value.quantityOptions.includes(10)) {
    context.addIssue({ code: 'custom', message: 'As opções 1x e 10x são obrigatórias.' });
  }
  if (new Set(value.quantityOptions).size !== value.quantityOptions.length) {
    context.addIssue({ code: 'custom', message: 'Remova as quantidades repetidas.' });
  }
  if (new Set(value.pool.map((entry) => entry.cardId)).size !== value.pool.length) {
    context.addIssue({ code: 'custom', message: 'Uma carta não pode aparecer mais de uma vez no pool.' });
  }
  const imageMetadataPresent = value.imageMimeType !== null
    && value.imageWidth !== null
    && value.imageHeight !== null;
  if ((value.imagePath === null && (value.imageMimeType !== null || value.imageWidth !== null || value.imageHeight !== null))
    || (value.imagePath !== null && !imageMetadataPresent)) {
    context.addIssue({ code: 'custom', path: ['imagePath'], message: 'Os dados da imagem principal estão incompletos.' });
  }
  const fallbackMetadataPresent = value.fallbackImageMimeType !== null
    && value.fallbackImageWidth !== null
    && value.fallbackImageHeight !== null;
  if ((value.fallbackImagePath === null && (
    value.fallbackImageMimeType !== null
    || value.fallbackImageWidth !== null
    || value.fallbackImageHeight !== null
  )) || (value.fallbackImagePath !== null && !fallbackMetadataPresent)) {
    context.addIssue({ code: 'custom', path: ['fallbackImagePath'], message: 'Os dados da imagem estática de fallback estão incompletos.' });
  }
  if (value.imageMimeType === 'image/gif' && !value.fallbackImagePath) {
    context.addIssue({ code: 'custom', path: ['fallbackImagePath'], message: 'GIFs precisam de uma imagem estática de fallback.' });
  }
});
const previewSchema = z.object({
  distributionMode: z.enum(['individual', 'rarity']),
  rarityCardSelection: z.enum(['equal', 'weighted']),
  pool: z.array(z.object({
    cardId: uuid,
    weight: z.number().int().positive().max(9_000_000_000_000_000),
    active: z.boolean()
  })).max(500),
  pity: pitySchema.nullable()
}).superRefine((value, context) => {
  if (new Set(value.pool.map((entry) => entry.cardId)).size !== value.pool.length) {
    context.addIssue({ code: 'custom', message: 'Uma carta não pode aparecer mais de uma vez no pool.' });
  }
});
const rewardSchema = z.object({
  rarityId: uuid,
  cardId: uuid.nullable(),
  goldAmount: positiveAmount,
  gemsAmount: positiveAmount,
  xpAmount: positiveAmount
}).refine((value) => value.goldAmount > 0 || value.gemsAmount > 0 || value.xpAmount > 0, {
  message: 'Configure ao menos uma recompensa positiva.'
});
const conversionsSchema = z.object({
  rarityDefaults: z.array(rewardSchema.refine((value) => value.cardId === null)).max(100),
  cardOverrides: z.array(rewardSchema.refine((value) => value.cardId !== null)).max(500)
}).superRefine((value, context) => {
  const rarityIds = value.rarityDefaults.map((item) => item.rarityId);
  const cardIds = value.cardOverrides.map((item) => item.cardId);
  if (new Set(rarityIds).size !== rarityIds.length) {
    context.addIssue({ code: 'custom', message: 'Há configurações repetidas para uma raridade.' });
  }
  if (new Set(cardIds).size !== cardIds.length) {
    context.addIssue({ code: 'custom', message: 'Há sobrescritas repetidas para uma carta.' });
  }
});

router.use(requireAdmin);

router.post('/banners/uploads', bannerImageUpload.single('image'), asyncHandler(async (request, response) => {
  if (!request.file) throw new AppError('Selecione uma imagem para enviar.', 400);
  const image = await saveUploadedImage(request.file.buffer, undefined, {
    allowedMimeTypes: allImageMimeTypes,
    declaredMimeType: request.file.mimetype,
    originalName: request.file.originalname
  });
  await inTransaction(async (client) => {
    await writeAudit(client, request.user!.id, 'banner_image_uploaded', 'image', image.imagePath, null, {
      mime: image.mime,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      frames: image.frames,
      durationMs: image.durationMs
    });
  });
  response.status(201).json({
    imagePath: image.imagePath,
    mimeType: image.mime,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
    frames: image.frames,
    durationMs: image.durationMs
  });
}));

router.get('/banners', asyncHandler(async (_request, response) => {
  const banners = await pool.query(
    `SELECT id, slug, name, description, active, starts_at, ends_at, time_zone, currency,
            unit_cost::text, image_path, image_mime_type, image_width, image_height,
            fallback_image_path, fallback_image_mime_type, fallback_image_width, fallback_image_height,
            image_focal_x, image_focal_y, quantity_options, distribution_mode, rarity_card_selection,
            version, created_by, updated_by, created_at, updated_at
     FROM invocation_banners ORDER BY created_at DESC, id`
  );
  const ids = banners.rows.map((banner) => banner.id);
  const [cards, pity, conversions] = await Promise.all([
    pool.query(
      `SELECT banner_id, card_id, weight::text, active
       FROM invocation_banner_cards WHERE banner_id = ANY($1::uuid[])
       ORDER BY banner_id, card_id`,
      [ids]
    ),
    pool.query(
      `SELECT banner_id, rarity_id, soft_pity_start, soft_pity_increment_bps, hard_pity_limit
       FROM invocation_pity_configs WHERE banner_id = ANY($1::uuid[])`,
      [ids]
    ),
    pool.query(
      `SELECT id, rarity_id, card_id, gold_amount::text, gems_amount::text, xp_amount::text
       FROM duplicate_reward_configs ORDER BY rarity_id, card_id NULLS FIRST`
    )
  ]);
  response.json({
    banners: banners.rows.map((banner) => ({
      id: banner.id,
      slug: banner.slug,
      name: banner.name,
      description: banner.description,
      active: banner.active,
      startsAt: banner.starts_at,
      endsAt: banner.ends_at,
      timeZone: banner.time_zone,
      currency: banner.currency,
      unitCost: Number(banner.unit_cost),
      imagePath: banner.image_path,
      imageMimeType: banner.image_mime_type,
      imageWidth: banner.image_width,
      imageHeight: banner.image_height,
      fallbackImagePath: banner.fallback_image_path,
      fallbackImageMimeType: banner.fallback_image_mime_type,
      fallbackImageWidth: banner.fallback_image_width,
      fallbackImageHeight: banner.fallback_image_height,
      imageFocalX: banner.image_focal_x,
      imageFocalY: banner.image_focal_y,
      quantityOptions: banner.quantity_options,
      distributionMode: banner.distribution_mode,
      rarityCardSelection: banner.rarity_card_selection,
      version: banner.version,
      createdBy: banner.created_by,
      updatedBy: banner.updated_by,
      createdAt: banner.created_at,
      updatedAt: banner.updated_at,
      pool: cards.rows.filter((entry) => entry.banner_id === banner.id).map((entry) => ({
        cardId: entry.card_id,
        weight: Number(entry.weight),
        active: entry.active
      })),
      pity: (() => {
        const entry = pity.rows.find((row) => row.banner_id === banner.id);
        return entry ? {
          rarityId: entry.rarity_id,
          softPityStart: entry.soft_pity_start,
          softPityIncrementBps: entry.soft_pity_increment_bps,
          hardPityLimit: entry.hard_pity_limit
        } : null;
      })()
    })),
    duplicateRewards: conversions.rows.map((entry) => ({
      id: entry.id,
      rarityId: entry.rarity_id,
      cardId: entry.card_id,
      goldAmount: entry.gold_amount,
      gemsAmount: entry.gems_amount,
      xpAmount: entry.xp_amount
    }))
  });
}));

router.post('/banners/preview', asyncHandler(async (request, response) => {
  const input = previewSchema.parse(request.body);
  const poolByCardId = new Map(input.pool.map((entry) => [entry.cardId, entry]));
  const cardIds = [...poolByCardId.keys()];
  const result = cardIds.length
    ? await pool.query<EligibleCard & { card_active: boolean }>(
      `SELECT cards.id, cards.name, cards.image_path, cards.description,
              cards.category_id, categories.name AS category_name,
              rarities.id AS rarity_id, rarities.name AS rarity_name,
              rarities.color_primary AS rarity_color_primary,
              rarities.color_secondary AS rarity_color_secondary,
              rarities.animation_level AS rarity_animation_level,
              rarities.sort_order AS rarity_sort_order,
              cards.weight::text AS card_weight, rarities.weight::text AS rarity_weight,
              (cards.active AND cards.deleted_at IS NULL) AS card_active,
              (rarities.active AND rarities.deleted_at IS NULL) AS rarity_active
       FROM cards
       JOIN rarities ON rarities.id = cards.rarity_id
       LEFT JOIN categories ON categories.id = cards.category_id
       WHERE cards.id = ANY($1::uuid[])
       ORDER BY cards.id`,
      [cardIds]
    )
    : { rows: [] };
  const foundCardIds = new Set(result.rows.map((card) => card.id));
  const cards: EligibleCard[] = result.rows.map((card) => {
    const poolEntry = poolByCardId.get(card.id)!;
    return {
      ...card,
      card_weight: String(poolEntry.weight),
      active: card.card_active && poolEntry.active
    };
  });

  let pityRule: PityRule | null = null;
  let targetRarityName: string | null = null;
  if (input.pity) {
    const target = await pool.query<{ name: string; sort_order: number }>(
      'SELECT name, sort_order FROM rarities WHERE id = $1 AND deleted_at IS NULL',
      [input.pity.rarityId]
    );
    if (!target.rows[0]) throw new AppError('A raridade de garantia não foi encontrada.', 400);
    targetRarityName = target.rows[0].name;
    pityRule = {
      targetSortOrder: target.rows[0].sort_order,
      softPityStart: input.pity.softPityStart,
      softPityIncrementBps: input.pity.softPityIncrementBps,
      hardPityLimit: input.pity.hardPityLimit
    };
  }

  const probabilities = cards.length
    ? calculateCardProbabilities(cards, input.distributionMode, input.rarityCardSelection)
    : [];
  const effectiveCards = probabilities
    .filter((card) => card.available)
    .map(({ available: _available, ...card }) => card);
  const odds = effectiveCards.length
    ? calculateInvocationOdds(effectiveCards, input.distributionMode, input.rarityCardSelection, 1, pityRule)
    : null;
  const targetAvailable = pityRule !== null
    && effectiveCards.some((card) => card.rarity_sort_order >= pityRule.targetSortOrder);

  response.json({
    cards: probabilities.map((card) => ({
      id: card.id,
      name: card.name,
      imagePath: card.image_path,
      rarityName: card.rarity_name,
      available: card.available,
      nominalCardChance: card.nominalCardChance,
      effectiveCardChance: card.effectiveCardChance,
      pityCardChance: pityRule
        ? odds?.cardChances.has(card.id) ? toNumber(odds.cardChances.get(card.id)!) : 0
        : null
    })),
    missingCardIds: cardIds.filter((id) => !foundCardIds.has(id)),
    pity: {
      configured: Boolean(pityRule),
      targetRarityName,
      position: 1,
      baseTargetChance: odds ? toNumber(odds.baseTargetChance) : 0,
      targetChance: odds ? toNumber(odds.targetChance) : 0,
      impossible: Boolean(pityRule && (!targetAvailable || odds?.impossible))
    }
  });
}));

router.post('/banners', asyncHandler(async (request, response) => {
  const input = bannerSchema.parse(request.body);
  if (input.version !== undefined) throw new AppError('Não envie versão ao criar um banner.', 400);
  const media = await resolveBannerMedia(input);
  const banner = await inTransaction(async (client) => {
    await validateTimeZone(input.timeZone);
    await validatePoolCards(client, input.pool.map((entry) => entry.cardId));
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO invocation_banners (
         slug, name, description, active, starts_at, ends_at, time_zone, currency, unit_cost,
         image_path, image_mime_type, image_width, image_height,
         fallback_image_path, fallback_image_mime_type, fallback_image_width, fallback_image_height,
         image_focal_x, image_focal_y, quantity_options, distribution_mode, rarity_card_selection,
         created_by, updated_by
       ) VALUES (
         $1, $2, $3, false, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21, $22, $22
       )
       RETURNING id`,
      [
        input.slug, input.name, input.description, input.startsAt, input.endsAt, input.timeZone,
        input.currency, input.unitCost, media.imagePath, media.imageMimeType, media.imageWidth,
        media.imageHeight, media.fallbackImagePath, media.fallbackImageMimeType,
        media.fallbackImageWidth, media.fallbackImageHeight, input.imageFocalX, input.imageFocalY,
        input.quantityOptions, input.distributionMode, input.rarityCardSelection, request.user!.id
      ]
    );
    const id = inserted.rows[0]!.id;
    await replaceBannerChildren(client, id, input);
    await client.query(
      'UPDATE invocation_banners SET active = $2 WHERE id = $1',
      [id, input.active]
    );
    await assertBannerConfiguration(client, id, input.active);
    const after = await readBannerConfiguration(client, id);
    await writeAudit(client, request.user!.id, 'invocation_banner_created', 'invocation_banner', id, null, after);
    return after;
  });
  response.status(201).json({ banner });
}));

router.put('/banners/:id', asyncHandler(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const input = bannerSchema.parse(request.body);
  if (input.version === undefined) throw new AppError('A versão atual do banner é obrigatória.', 400);
  const banner = await inTransaction(async (client) => {
    await validateTimeZone(input.timeZone);
    await validatePoolCards(client, input.pool.map((entry) => entry.cardId));
    const current = await client.query<{
      version: number;
      image_path: string | null;
      image_mime_type: string | null;
      image_width: number | null;
      image_height: number | null;
      fallback_image_path: string | null;
      fallback_image_mime_type: string | null;
      fallback_image_width: number | null;
      fallback_image_height: number | null;
    }>(
      `SELECT version, image_path, image_mime_type, image_width, image_height,
              fallback_image_path, fallback_image_mime_type, fallback_image_width, fallback_image_height
       FROM invocation_banners WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!current.rows[0]) throw new AppError('Banner não encontrado.', 404);
    if (current.rows[0].version !== input.version) {
      throw new AppError('O banner foi alterado por outro administrador. Atualize os dados e tente novamente.', 409);
    }
    const media = await resolveBannerMedia(input, current.rows[0]);
    const before = await readBannerConfiguration(client, id);
    await client.query(
      `UPDATE invocation_banners SET
         slug = $2, name = $3, description = $4, active = false, starts_at = $5, ends_at = $6,
         time_zone = $7, currency = $8, unit_cost = $9, image_path = $10,
         image_mime_type = $11, image_width = $12, image_height = $13,
         fallback_image_path = $14, fallback_image_mime_type = $15,
         fallback_image_width = $16, fallback_image_height = $17,
         image_focal_x = $18, image_focal_y = $19, quantity_options = $20,
         distribution_mode = $21, rarity_card_selection = $22,
         updated_by = $23, updated_at = now(), version = version + 1
       WHERE id = $1`,
      [
        id, input.slug, input.name, input.description, input.startsAt, input.endsAt,
        input.timeZone, input.currency, input.unitCost, media.imagePath, media.imageMimeType,
        media.imageWidth, media.imageHeight, media.fallbackImagePath, media.fallbackImageMimeType,
        media.fallbackImageWidth, media.fallbackImageHeight, input.imageFocalX, input.imageFocalY,
        input.quantityOptions, input.distributionMode, input.rarityCardSelection, request.user!.id
      ]
    );
    await replaceBannerChildren(client, id, input);
    await client.query('UPDATE invocation_banners SET active = $2 WHERE id = $1', [id, input.active]);
    await assertBannerConfiguration(client, id, input.active);
    const after = await readBannerConfiguration(client, id);
    await writeAudit(client, request.user!.id, 'invocation_banner_updated', 'invocation_banner', id, before, after);
    return after;
  });
  response.json({ banner });
}));

router.put('/duplicate-rewards', asyncHandler(async (request, response) => {
  const input = conversionsSchema.parse(request.body);
  const result = await inTransaction(async (client) => {
    const before = await readDuplicateRewards(client);
    await validateRewardConfiguration(client, input.rarityDefaults, input.cardOverrides);
    await client.query('DELETE FROM duplicate_reward_configs');
    for (const reward of [...input.rarityDefaults, ...input.cardOverrides]) {
      await client.query(
        `INSERT INTO duplicate_reward_configs
           (rarity_id, card_id, gold_amount, gems_amount, xp_amount, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          reward.rarityId, reward.cardId, reward.goldAmount, reward.gemsAmount,
          reward.xpAmount, request.user!.id
        ]
      );
    }
    const activeBanners = await client.query<{ id: string }>(
      'SELECT id FROM invocation_banners WHERE active = true ORDER BY id'
    );
    for (const banner of activeBanners.rows) {
      await assertBannerConfiguration(client, banner.id, true);
    }
    const after = await readDuplicateRewards(client);
    await writeAudit(
      client, request.user!.id, 'duplicate_rewards_updated', 'duplicate_reward_config', null,
      before, after
    );
    return after;
  });
  response.json({ duplicateRewards: result });
}));

async function replaceBannerChildren(
  client: import('pg').PoolClient,
  bannerId: string,
  input: z.infer<typeof bannerSchema>
): Promise<void> {
  await client.query('DELETE FROM invocation_banner_cards WHERE banner_id = $1', [bannerId]);
  for (const card of input.pool) {
    await client.query(
      `INSERT INTO invocation_banner_cards (banner_id, card_id, weight, active)
       VALUES ($1, $2, $3, $4)`,
      [bannerId, card.cardId, card.weight, card.active]
    );
  }
  await client.query('DELETE FROM invocation_pity_configs WHERE banner_id = $1', [bannerId]);
  if (input.pity) {
    const rarity = await client.query(
      'SELECT 1 FROM rarities WHERE id = $1 AND deleted_at IS NULL',
      [input.pity.rarityId]
    );
    if (!rarity.rowCount) throw new AppError('A raridade de garantia não foi encontrada.', 404);
    await client.query(
      `INSERT INTO invocation_pity_configs
         (banner_id, rarity_id, soft_pity_start, soft_pity_increment_bps, hard_pity_limit)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        bannerId, input.pity.rarityId, input.pity.softPityStart,
        input.pity.softPityIncrementBps, input.pity.hardPityLimit
      ]
    );
  }
}

async function resolveBannerMedia(
  input: z.infer<typeof bannerSchema>,
  current?: {
    image_path: string | null;
    image_mime_type: string | null;
    image_width: number | null;
    image_height: number | null;
    fallback_image_path: string | null;
    fallback_image_mime_type: string | null;
    fallback_image_width: number | null;
    fallback_image_height: number | null;
  }
) {
  const image = input.imagePath
    ? input.imagePath === current?.image_path
      ? {
        mime: current.image_mime_type,
        width: current.image_width,
        height: current.image_height
      }
      : await inspectSavedImage(input.imagePath, allImageMimeTypes)
    : null;
  const fallback = input.fallbackImagePath
    ? input.fallbackImagePath === current?.fallback_image_path
      ? {
        mime: current.fallback_image_mime_type,
        width: current.fallback_image_width,
        height: current.fallback_image_height
      }
      : await inspectSavedImage(input.fallbackImagePath, staticImageMimeTypes)
    : null;

  if (image && (
    image.mime !== input.imageMimeType
    || image.width !== input.imageWidth
    || image.height !== input.imageHeight
  )) {
    throw new AppError('Os metadados da imagem do banner não correspondem ao arquivo enviado.', 400);
  }
  if (fallback && (
    fallback.mime !== input.fallbackImageMimeType
    || fallback.width !== input.fallbackImageWidth
    || fallback.height !== input.fallbackImageHeight
  )) {
    throw new AppError('Os metadados da imagem estática não correspondem ao arquivo enviado.', 400);
  }
  if (image?.mime === 'image/gif' && !fallback) {
    throw new AppError('GIFs precisam de uma imagem estática de fallback.', 400);
  }

  return {
    imagePath: input.imagePath,
    imageMimeType: image?.mime ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    fallbackImagePath: input.fallbackImagePath,
    fallbackImageMimeType: fallback?.mime ?? null,
    fallbackImageWidth: fallback?.width ?? null,
    fallbackImageHeight: fallback?.height ?? null
  };
}

async function validatePoolCards(client: import('pg').PoolClient, cardIds: string[]): Promise<void> {
  if (!cardIds.length) return;
  const result = await client.query<{ id: string }>(
    'SELECT id FROM cards WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
    [cardIds]
  );
  if (result.rowCount !== cardIds.length) {
    throw new AppError('O pool contém uma carta inexistente ou removida.', 400);
  }
}

async function validateTimeZone(timeZone: string): Promise<void> {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new AppError('O fuso horário do banner não é válido.', 400);
  }
}

async function validateRewardConfiguration(
  client: import('pg').PoolClient,
  defaults: z.infer<typeof rewardSchema>[],
  overrides: z.infer<typeof rewardSchema>[]
): Promise<void> {
  const rarityIds = [...new Set([...defaults, ...overrides].map((item) => item.rarityId))];
  const cardIds = overrides.flatMap((item) => item.cardId ? [item.cardId] : []);
  const rarities = rarityIds.length ? await client.query<{
    id: string;
    duplicate_tier: string | null;
  }>('SELECT id, duplicate_tier FROM rarities WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [rarityIds]) : { rows: [] };
  if (rarities.rows.length !== rarityIds.length) {
    throw new AppError('Uma raridade da conversão não existe ou foi removida.', 404);
  }
  const rarityById = new Map(
    rarities.rows.map((rarity): [string, typeof rarity] => [rarity.id, rarity])
  );
  const cards = cardIds.length ? await client.query<{ id: string; rarity_id: string }>(
    'SELECT id, rarity_id FROM cards WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
    [cardIds]
  ) : { rows: [] };
  if (cards.rows.length !== cardIds.length) {
    throw new AppError('Uma carta da sobrescrita não existe ou foi removida.', 404);
  }
  const cardById = new Map(
    cards.rows.map((card): [string, typeof card] => [card.id, card])
  );

  for (const reward of [...defaults, ...overrides]) {
    const rarity = rarityById.get(reward.rarityId)!;
    assertDuplicateRewardPolicy(
      rarity.duplicate_tier,
      BigInt(reward.goldAmount),
      BigInt(reward.gemsAmount),
      BigInt(reward.xpAmount)
    );
    if (reward.cardId && cardById.get(reward.cardId)?.rarity_id !== reward.rarityId) {
      throw new AppError('A raridade informada não corresponde à carta sobrescrita.', 400);
    }
  }
}

async function readBannerConfiguration(client: import('pg').PoolClient, id: string) {
  const [banner, cards, pity] = await Promise.all([
    client.query('SELECT * FROM invocation_banners WHERE id = $1', [id]),
    client.query(
      `SELECT card_id, weight::text, active FROM invocation_banner_cards
       WHERE banner_id = $1 ORDER BY card_id`,
      [id]
    ),
    client.query(
      `SELECT rarity_id, soft_pity_start, soft_pity_increment_bps, hard_pity_limit
       FROM invocation_pity_configs WHERE banner_id = $1`,
      [id]
    )
  ]);
  if (!banner.rows[0]) throw new AppError('Banner não encontrado.', 404);
  const row = banner.rows[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    active: row.active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timeZone: row.time_zone,
    currency: row.currency,
    unitCost: Number(row.unit_cost),
    imagePath: row.image_path,
    imageMimeType: row.image_mime_type,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    fallbackImagePath: row.fallback_image_path,
    fallbackImageMimeType: row.fallback_image_mime_type,
    fallbackImageWidth: row.fallback_image_width,
    fallbackImageHeight: row.fallback_image_height,
    imageFocalX: row.image_focal_x,
    imageFocalY: row.image_focal_y,
    quantityOptions: row.quantity_options,
    distributionMode: row.distribution_mode,
    rarityCardSelection: row.rarity_card_selection,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    pool: cards.rows.map((entry) => ({
      cardId: entry.card_id,
      weight: Number(entry.weight),
      active: entry.active
    })),
    pity: pity.rows[0] ? {
      rarityId: pity.rows[0].rarity_id,
      softPityStart: pity.rows[0].soft_pity_start,
      softPityIncrementBps: pity.rows[0].soft_pity_increment_bps,
      hardPityLimit: pity.rows[0].hard_pity_limit
    } : null
  };
}

async function readDuplicateRewards(client: import('pg').PoolClient) {
  const result = await client.query(
    `SELECT rarity_id, card_id, gold_amount::text, gems_amount::text, xp_amount::text
     FROM duplicate_reward_configs ORDER BY rarity_id, card_id NULLS FIRST`
  );
  return result.rows;
}

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
