import { Router } from 'express';
import { asyncHandler } from '../http/async-handler.js';
import { loadEligibleCards } from '../services/probabilities.js';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT cards.id, cards.name, cards.image_path, cards.description,
            cards.rarity_id, cards.category_id, rarities.sort_order AS rarity_sort_order,
            categories.name AS category_name,
            rarities.name AS rarity_name, rarities.color_primary, rarities.color_secondary,
            rarities.animation_level
     FROM cards
     JOIN rarities ON rarities.id = cards.rarity_id
     LEFT JOIN categories ON categories.id = cards.category_id
     WHERE cards.active = true AND cards.deleted_at IS NULL
       AND rarities.active = true AND rarities.deleted_at IS NULL
     ORDER BY rarities.sort_order, cards.name`
  );
  response.json({ cards: result.rows });
}));

router.get('/probabilities', asyncHandler(async (_request, response) => {
  const cards = await loadEligibleCards();
  response.json({
    cards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      rarityId: card.rarity_id,
      rarityName: card.rarity_name,
      nominalCardChance: card.nominalCardChance,
      nominalRarityChance: card.nominalRarityChance,
      effectiveCardChance: card.effectiveCardChance,
      effectiveRarityChance: card.effectiveRarityChance,
      effectiveCardNumerator: card.effectiveCardNumerator,
      effectiveCardDenominator: card.effectiveCardDenominator,
      effectiveRarityNumerator: card.effectiveRarityNumerator,
      effectiveRarityDenominator: card.effectiveRarityDenominator
    }))
  });
}));

router.get('/rarities', asyncHandler(async (_request, response) => {
  const result = await pool.query(
    `SELECT id, name, color_primary, color_secondary, sort_order, active, deleted_at
     FROM rarities ORDER BY sort_order, name`
  );
  response.json({ rarities: result.rows });
}));

export default router;
