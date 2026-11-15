import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';
import { loadEligibleCards } from '../services/probabilities.js';
import { getSetting } from '../services/settings.js';
import { executeInvocation, readInvocationByKey } from '../services/invocation-draw.js';

const router = Router();
const drawSchema = z.object({
  bannerId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
  idempotencyKey: z.string().uuid()
});

router.use(requireAuth);

router.get('/options', asyncHandler(async (_request, response) => {
  const [currency, goldCost, gemsCost, maxQuantity, cards, eventEnabled,
    discountPercent, startsAt, endsAt] = await Promise.all([
    getSetting<'gold' | 'gems'>('draw_currency', 'gold'),
    getSetting<number>('draw_cost_gold', await getSetting<number>('draw_cost', 10)),
    getSetting<number>('draw_cost_gems', 1),
    getSetting<number>('draw_max_quantity', 10),
    loadEligibleCards(),
    getSetting<boolean>('draw_event_enabled', false),
    getSetting<number>('draw_event_discount_percent', 0),
    getSetting<string | null>('draw_event_starts_at', null),
    getSetting<string | null>('draw_event_ends_at', null)
  ]);
  const baseCost = currency === 'gold' ? goldCost : gemsCost;
  const promotionActive = isPromotionActive(eventEnabled, discountPercent, startsAt, endsAt);
  const unitCost = promotionActive ? discountedCost(baseCost, discountPercent) : baseCost;
  if (!Number.isSafeInteger(unitCost) || unitCost <= 0) {
    throw new AppError('O custo do sorteio está inválido.', 503);
  }
  response.json({
    unitCost,
    originalUnitCost: baseCost,
    currency,
    promotionActive,
    maxQuantity,
    cards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      rarityId: card.rarity_id,
      rarityName: card.rarity_name,
      effectiveCardChance: card.effectiveCardChance,
      effectiveRarityChance: card.effectiveRarityChance,
      effectiveCardNumerator: card.effectiveCardNumerator,
      effectiveCardDenominator: card.effectiveCardDenominator,
      effectiveRarityNumerator: card.effectiveRarityNumerator,
      effectiveRarityDenominator: card.effectiveRarityDenominator
    }))
  });
}));

router.post('/', asyncHandler(async (request, response) => {
  const input = drawSchema.parse(request.body);
  const result = await executeInvocation(
    request.user!.id, input.bannerId, input.quantity, input.idempotencyKey
  );
  response.json(result);
}));

router.get('/operations/:key', asyncHandler(async (request, response) => {
  const key = z.string().uuid().parse(request.params.key);
  response.json(await readInvocationByKey(request.user!.id, key));
}));

router.get('/history', asyncHandler(async (request, response) => {
  const query = z.object({
    rarityId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  }).parse(request.query);
  const clauses = ['draws.user_id = $1'];
  const values: unknown[] = [request.user!.id];
  if (query.rarityId) {
    values.push(query.rarityId);
    clauses.push(`draws.rarity_id = $${values.length}`);
  }
  if (query.from) {
    values.push(query.from);
    clauses.push(`draws.created_at >= $${values.length}`);
  }
  if (query.to) {
    values.push(query.to);
    clauses.push(`draws.created_at <= $${values.length}`);
  }
  values.push(query.limit);
  const result = await pool.query(
    `SELECT draws.id, draws.card_id, draws.card_name, draws.rarity_id, draws.rarity_name,
            draws.rarity_color_primary, draws.rarity_color_secondary, draws.animation_level,
            draws.visual_effect,
            draws.image_path, draws.nominal_card_chance, draws.nominal_rarity_chance,
            draws.effective_card_chance, draws.effective_rarity_chance,
            draws.effective_card_numerator, draws.effective_card_denominator,
            draws.is_duplicate, draws.collection_quantity, draws.duplicate_gold_amount::text,
            draws.duplicate_gems_amount::text, draws.duplicate_xp_amount::text,
            draws.youtube_video_id, draw_batches.banner_id, draw_batches.banner_name,
            draws.created_at, draw_batches.unit_cost, draw_batches.currency
     FROM draws
     JOIN draw_batches ON draw_batches.id = draws.batch_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY draws.created_at DESC, draws.id DESC LIMIT $${values.length}`,
    values
  );
  response.json({ draws: result.rows });
}));

router.get('/collection', asyncHandler(async (request, response) => {
  const result = await pool.query(
    `SELECT user_cards.card_id, user_cards.quantity, user_cards.first_obtained_at,
            user_cards.last_obtained_at, cards.name, cards.image_path, cards.description,
            cards.id, cards.rarity_id, cards.category_id,
            rarities.sort_order AS rarity_sort_order,
            categories.name AS category_name, rarities.name AS rarity_name,
            rarities.color_primary, rarities.color_secondary, rarities.animation_level
     FROM user_cards
     JOIN cards ON cards.id = user_cards.card_id
     JOIN rarities ON rarities.id = cards.rarity_id
     LEFT JOIN categories ON categories.id = cards.category_id
     WHERE user_cards.user_id = $1
     ORDER BY rarities.sort_order DESC, cards.name`,
    [request.user!.id]
  );
  response.json({ cards: result.rows });
}));

export default router;

function nullableStringSetting(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AppError('A configuração de evento possui uma data inválida.', 503);
  return value;
}

function isPromotionActive(
  enabled: boolean,
  discountPercent: number,
  startsAt: string | null,
  endsAt: string | null
): boolean {
  if (!Number.isSafeInteger(discountPercent) || discountPercent < 0 || discountPercent > 99) {
    throw new AppError('O desconto promocional está inválido.', 503);
  }
  if (!enabled || discountPercent === 0 || !startsAt || !endsAt) return false;
  const starts = new Date(startsAt).getTime();
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts >= ends) {
    throw new AppError('O período promocional está inválido.', 503);
  }
  const now = Date.now();
  return now >= starts && now < ends;
}

function discountedCost(baseCost: number, discountPercent: number): number {
  if (!Number.isSafeInteger(baseCost) || baseCost <= 0) {
    throw new AppError('O custo do sorteio está inválido.', 503);
  }
  return Math.max(1, Math.floor(baseCost * (100 - discountPercent) / 100));
}

