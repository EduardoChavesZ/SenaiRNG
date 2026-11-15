import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';
import {
  calculateCardProbabilities,
  calculateEffectiveCards,
  type DistributionMode,
  type EligibleCard,
  type RarityCardSelection
} from '../services/probabilities.js';
import { calculateInvocationOdds, toNumber, type PityRule } from '../services/invocation.js';

const router = Router();
const uuid = z.string().uuid();

router.use(requireAuth);

router.get('/banners', asyncHandler(async (_request, response) => {
  const result = await pool.query<{
    id: string;
    slug: string;
    name: string;
    description: string;
    starts_at: Date | null;
    ends_at: Date | null;
    time_zone: string;
    currency: 'gold' | 'gems';
    unit_cost: string;
    image_path: string | null;
    image_mime_type: string | null;
    image_width: number | null;
    image_height: number | null;
    fallback_image_path: string | null;
    image_focal_x: number;
    image_focal_y: number;
    quantity_options: number[];
    eligible_count: string;
    target_eligible_count: string | null;
    has_pity: boolean;
  }>(
    `SELECT banners.id, banners.slug, banners.name, banners.description,
            banners.image_path, banners.image_mime_type, banners.image_width, banners.image_height,
            banners.fallback_image_path, banners.image_focal_x, banners.image_focal_y,
            banners.starts_at, banners.ends_at, banners.time_zone, banners.currency,
            banners.unit_cost::text, banners.quantity_options,
            count(*) FILTER (
              WHERE banner_cards.active AND cards.active AND rarities.active
                AND cards.deleted_at IS NULL AND rarities.deleted_at IS NULL
            )::text AS eligible_count,
            count(*) FILTER (
              WHERE pity.banner_id IS NOT NULL AND banner_cards.active
                AND cards.active AND rarities.active
                AND cards.deleted_at IS NULL AND rarities.deleted_at IS NULL
                AND rarities.sort_order >= target_rarity.sort_order
            )::text AS target_eligible_count,
            (pity.banner_id IS NOT NULL) AS has_pity
     FROM invocation_banners AS banners
     LEFT JOIN invocation_banner_cards AS banner_cards ON banner_cards.banner_id = banners.id
     LEFT JOIN cards ON cards.id = banner_cards.card_id
     LEFT JOIN rarities ON rarities.id = cards.rarity_id
     LEFT JOIN invocation_pity_configs AS pity ON pity.banner_id = banners.id
     LEFT JOIN rarities AS target_rarity ON target_rarity.id = pity.rarity_id
     WHERE banners.active = true
     GROUP BY banners.id, pity.banner_id
     ORDER BY banners.starts_at NULLS FIRST, banners.created_at DESC, banners.id`
  );
  const now = Date.now();
  response.json({
    banners: result.rows.map((banner) => {
      const availability = bannerAvailability({
        startsAt: banner.starts_at,
        endsAt: banner.ends_at,
        now,
        eligibleCount: Number(banner.eligible_count),
        targetEligibleCount: banner.target_eligible_count === null
          ? null
          : Number(banner.target_eligible_count),
        hasPity: banner.has_pity
      });
      return {
        id: banner.id,
        slug: banner.slug,
        name: banner.name,
        description: banner.description,
        imagePath: banner.image_path,
        imageMimeType: banner.image_mime_type,
        imageWidth: banner.image_width,
        imageHeight: banner.image_height,
        fallbackImagePath: banner.fallback_image_path,
        imageFocalX: banner.image_focal_x,
        imageFocalY: banner.image_focal_y,
        startsAt: banner.starts_at,
        endsAt: banner.ends_at,
        timeZone: banner.time_zone,
        currency: banner.currency,
        unitCost: Number(banner.unit_cost),
        quantityOptions: banner.quantity_options,
        availability
      };
    })
  });
}));

router.get('/banners/:id', asyncHandler(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const banner = await pool.query<{
    id: string;
    slug: string;
    name: string;
    description: string;
    starts_at: Date | null;
    ends_at: Date | null;
    time_zone: string;
    currency: 'gold' | 'gems';
    unit_cost: string;
    image_path: string | null;
    image_mime_type: string | null;
    image_width: number | null;
    image_height: number | null;
    fallback_image_path: string | null;
    image_focal_x: number;
    image_focal_y: number;
    quantity_options: number[];
    distribution_mode: DistributionMode;
    rarity_card_selection: RarityCardSelection;
  }>(
    `SELECT id, slug, name, description, image_path, image_mime_type, image_width, image_height,
            fallback_image_path, image_focal_x, image_focal_y,
            starts_at, ends_at, time_zone, currency,
            unit_cost::text, quantity_options, distribution_mode, rarity_card_selection
     FROM invocation_banners WHERE id = $1 AND active = true`,
    [id]
  );
  const bannerData = banner.rows[0];
  if (!bannerData) throw new AppError('Banner não encontrado.', 404);

  const [poolResult, pityResult] = await Promise.all([
    pool.query<EligibleCard & { youtube_video_id: string | null; banner_card_active: boolean }>(
      `SELECT cards.id, cards.name, cards.image_path, cards.description,
              cards.category_id, categories.name AS category_name,
              rarities.id AS rarity_id, rarities.name AS rarity_name,
              rarities.color_primary AS rarity_color_primary,
              rarities.color_secondary AS rarity_color_secondary,
              rarities.animation_level AS rarity_animation_level,
              rarities.sort_order AS rarity_sort_order,
              banner_cards.weight::text AS card_weight, rarities.weight::text AS rarity_weight,
              (cards.active AND banner_cards.active) AS active,
              rarities.active AS rarity_active, cards.youtube_video_id,
              banner_cards.active AS banner_card_active
       FROM invocation_banner_cards AS banner_cards
       JOIN cards ON cards.id = banner_cards.card_id AND cards.deleted_at IS NULL
       JOIN rarities ON rarities.id = cards.rarity_id AND rarities.deleted_at IS NULL
       LEFT JOIN categories ON categories.id = cards.category_id
       WHERE banner_cards.banner_id = $1
       ORDER BY rarities.sort_order DESC, cards.name`,
      [id]
    ),
    pool.query<{
      rarity_id: string;
      rarity_name: string;
      target_sort_order: number;
      soft_pity_start: number | null;
      soft_pity_increment_bps: number;
      hard_pity_limit: number | null;
      failures_count: number;
    }>(
      `SELECT config.rarity_id, rarity.name AS rarity_name,
              rarity.sort_order AS target_sort_order, config.soft_pity_start,
              config.soft_pity_increment_bps, config.hard_pity_limit,
              COALESCE(state.failures_count, 0) AS failures_count
       FROM invocation_pity_configs AS config
       JOIN rarities AS rarity ON rarity.id = config.rarity_id
       LEFT JOIN user_banner_pity AS state
         ON state.banner_id = config.banner_id AND state.user_id = $2
       WHERE config.banner_id = $1`,
      [id, request.user!.id]
    )
  ]);
  const allPoolCards = poolResult.rows.map((card) => ({
    ...card,
    active: card.active && card.banner_card_active
  }));
  const probabilityRows = calculateCardProbabilities(
    allPoolCards,
    bannerData.distribution_mode,
    bannerData.rarity_card_selection
  );
  const youtubeVideoIdByCard = new Map(
    allPoolCards.map((card) => [card.id, card.youtube_video_id])
  );
  const eligible = calculateEffectiveCards(
    allPoolCards,
    bannerData.distribution_mode,
    bannerData.rarity_card_selection
  );
  const configuredPity = pityResult.rows[0];
  const pityRule: PityRule | null = configuredPity ? {
    targetSortOrder: configuredPity.target_sort_order,
    softPityStart: configuredPity.soft_pity_start,
    softPityIncrementBps: configuredPity.soft_pity_increment_bps,
    hardPityLimit: configuredPity.hard_pity_limit
  } : null;
  const pityPosition = (configuredPity?.failures_count ?? 0) + 1;
  const odds = eligible.length
    ? calculateInvocationOdds(
      eligible,
      bannerData.distribution_mode,
      bannerData.rarity_card_selection,
      pityPosition,
      pityRule
    )
    : null;
  const now = Date.now();
  const availability = bannerAvailability({
    startsAt: bannerData.starts_at,
    endsAt: bannerData.ends_at,
    now,
    eligibleCount: eligible.length,
    targetEligibleCount: configuredPity
      ? eligible.filter((card) => card.rarity_sort_order >= configuredPity.target_sort_order).length
      : null,
    hasPity: Boolean(configuredPity)
  });
  const pityImpossible = Boolean(odds?.impossible);
  const finalAvailability = pityImpossible
    ? { available: false, status: 'pity_unavailable', reason: 'Não há carta elegível para cumprir a garantia configurada.' }
    : availability;

  response.json({
    banner: {
      id: bannerData.id,
      slug: bannerData.slug,
      name: bannerData.name,
      description: bannerData.description,
      imagePath: bannerData.image_path,
      imageMimeType: bannerData.image_mime_type,
      imageWidth: bannerData.image_width,
      imageHeight: bannerData.image_height,
      fallbackImagePath: bannerData.fallback_image_path,
      imageFocalX: bannerData.image_focal_x,
      imageFocalY: bannerData.image_focal_y,
      startsAt: bannerData.starts_at,
      endsAt: bannerData.ends_at,
      timeZone: bannerData.time_zone,
      currency: bannerData.currency,
      unitCost: Number(bannerData.unit_cost),
      quantityOptions: bannerData.quantity_options,
      availability: finalAvailability,
      pity: configuredPity ? {
        targetRarityId: configuredPity.rarity_id,
        targetRarityName: configuredPity.rarity_name,
        failures: configuredPity.failures_count,
        position: pityPosition,
        softPityStart: configuredPity.soft_pity_start,
        softPityIncrementBps: configuredPity.soft_pity_increment_bps,
        hardPityLimit: configuredPity.hard_pity_limit,
        baseTargetChance: odds?.baseTargetChance.numerator.toString() ?? '0',
        baseTargetChanceDenominator: odds?.baseTargetChance.denominator.toString() ?? '1',
        effectiveTargetChance: odds ? toNumber(odds.targetChance) : 0,
        effectiveTargetChanceNumerator: odds?.targetChance.numerator.toString() ?? '0',
        effectiveTargetChanceDenominator: odds?.targetChance.denominator.toString() ?? '1'
      } : null,
      pool: probabilityRows
        .filter((card) => card.available)
        .map((card) => {
          const chance = odds?.cardChances.get(card.id);
          return {
            id: card.id,
            name: card.name,
            imagePath: card.image_path,
            description: card.description,
            rarityId: card.rarity_id,
            rarityName: card.rarity_name,
            rarityColorPrimary: card.rarity_color_primary,
            rarityColorSecondary: card.rarity_color_secondary,
            animationLevel: card.rarity_animation_level,
            youtubeVideoId: youtubeVideoIdByCard.get(card.id) ?? null,
            effectiveCardChance: chance && !pityImpossible ? toNumber(chance) : null,
            effectiveCardNumerator: chance && !pityImpossible ? chance.numerator.toString() : null,
            effectiveCardDenominator: chance && !pityImpossible ? chance.denominator.toString() : null
          };
        })
    }
  });
}));

router.get('/banners/:id/pity', asyncHandler(async (request, response) => {
  const id = uuid.parse(request.params.id);
  const result = await pool.query(
    `SELECT config.rarity_id AS "targetRarityId", rarity.name AS "targetRarityName",
            config.soft_pity_start AS "softPityStart",
            config.soft_pity_increment_bps AS "softPityIncrementBps",
            config.hard_pity_limit AS "hardPityLimit",
            COALESCE(state.failures_count, 0) AS failures,
            COALESCE(state.failures_count, 0) + 1 AS position
     FROM invocation_pity_configs AS config
     JOIN invocation_banners AS banner ON banner.id = config.banner_id AND banner.active = true
     JOIN rarities AS rarity ON rarity.id = config.rarity_id
     LEFT JOIN user_banner_pity AS state
       ON state.banner_id = config.banner_id AND state.user_id = $2
     WHERE config.banner_id = $1`,
    [id, request.user!.id]
  );
  if (!result.rows[0]) {
    const banner = await pool.query('SELECT 1 FROM invocation_banners WHERE id = $1 AND active = true', [id]);
    if (!banner.rowCount) throw new AppError('Banner não encontrado.', 404);
    response.json({ pity: null });
    return;
  }
  response.json({ pity: result.rows[0] });
}));

function bannerAvailability(input: {
  startsAt: Date | null;
  endsAt: Date | null;
  now: number;
  eligibleCount: number;
  targetEligibleCount: number | null;
  hasPity: boolean;
}): { available: boolean; status: string; reason: string | null } {
  if (input.startsAt && new Date(input.startsAt).getTime() > input.now) {
    return { available: false, status: 'upcoming', reason: 'Este banner ainda não está disponível.' };
  }
  if (input.endsAt && new Date(input.endsAt).getTime() <= input.now) {
    return { available: false, status: 'ended', reason: 'O período deste banner foi encerrado.' };
  }
  if (input.eligibleCount === 0) {
    return { available: false, status: 'empty_pool', reason: 'Não há cartas ativas neste banner.' };
  }
  if (input.hasPity && input.targetEligibleCount === 0) {
    return { available: false, status: 'pity_unavailable', reason: 'A garantia configurada não possui carta elegível.' };
  }
  return { available: true, status: 'available', reason: null };
}

export default router;
