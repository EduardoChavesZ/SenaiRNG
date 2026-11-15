import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  calculateCardProbabilities,
  calculateEffectiveCards,
  type DistributionMode,
  type EffectiveCard,
  type EligibleCard,
  type RarityCardSelection
} from './distribution.js';
import { getSetting } from './settings.js';

export {
  calculateEffectiveCards,
  calculateCardProbabilities,
  type DistributionMode,
  type EffectiveCard,
  type EligibleCard,
  type RarityCardSelection
} from './distribution.js';

export async function loadCardRows(client?: PoolClient, lock = false): Promise<EligibleCard[]> {
  const executor = client ?? pool;
  const result = await executor.query<EligibleCard>(
    `SELECT cards.id, cards.name, cards.image_path, cards.description,
            cards.category_id, categories.name AS category_name,
            rarities.id AS rarity_id, rarities.name AS rarity_name,
            rarities.color_primary AS rarity_color_primary,
            rarities.color_secondary AS rarity_color_secondary,
            rarities.animation_level AS rarity_animation_level,
            rarities.sort_order AS rarity_sort_order,
            cards.weight AS card_weight, rarities.weight AS rarity_weight,
            cards.active, rarities.active AS rarity_active
     FROM cards
     JOIN rarities ON rarities.id = cards.rarity_id
     LEFT JOIN categories ON categories.id = cards.category_id
     WHERE cards.deleted_at IS NULL AND rarities.deleted_at IS NULL
     ORDER BY rarities.id, cards.id${lock ? ' FOR UPDATE OF cards, rarities' : ''}`,
    []
  );
  return result.rows;
}

export async function loadEligibleCards(client?: PoolClient, lock = false): Promise<EffectiveCard[]> {
  const allCards = await loadCardRows(client, lock);
  const mode = await getSetting<DistributionMode>('distribution_mode', 'individual', client);
  const innerSelection = await getSetting<RarityCardSelection>('rarity_card_selection', 'equal', client);
  return calculateEffectiveCards(allCards, mode, innerSelection);
}

export async function loadAllCardProbabilities() {
  const allCards = await loadCardRows();
  const mode = await getSetting<DistributionMode>('distribution_mode', 'individual');
  const innerSelection = await getSetting<RarityCardSelection>('rarity_card_selection', 'equal');
  return calculateCardProbabilities(allCards, mode, innerSelection);
}
