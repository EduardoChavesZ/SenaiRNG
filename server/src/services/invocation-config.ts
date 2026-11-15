import type { PoolClient } from 'pg';
import { AppError } from '../errors.js';

const gemEligibleTiers = new Set(['epic', 'legendary', 'secret']);

export function assertDuplicateRewardPolicy(
  duplicateTier: string | null,
  gold: bigint,
  gems: bigint,
  xp: bigint,
  status = 400
): void {
  if (!duplicateTier || !['common', 'uncommon', 'rare', 'epic', 'legendary', 'secret'].includes(duplicateTier)) {
    throw new AppError('Classifique a raridade antes de configurar conversões de duplicatas.', status);
  }
  if (gold <= 0n || xp <= 0n) {
    throw new AppError('Toda conversão de duplicata precisa conceder moedas e XP.', status);
  }
  const earnsGems = gemEligibleTiers.has(duplicateTier);
  if (earnsGems && gems <= 0n) {
    throw new AppError('Raridades Épicas ou superiores precisam conceder gemas, moedas e XP.', status);
  }
  if (!earnsGems && gems > 0n) {
    throw new AppError('Somente duplicatas Épicas ou superiores podem conceder gemas.', status);
  }
}

export async function assertBannerConfiguration(
  client: PoolClient,
  bannerId: string,
  requirePublishable: boolean
): Promise<void> {
  const pityResult = await client.query<{
    target_sort_order: number;
    target_rarity_active: boolean;
    target_rarity_deleted_at: Date | null;
  }>(
    `SELECT rarities.sort_order AS target_sort_order, rarities.active AS target_rarity_active,
            rarities.deleted_at AS target_rarity_deleted_at
     FROM invocation_pity_configs
     JOIN rarities ON rarities.id = invocation_pity_configs.rarity_id
     WHERE invocation_pity_configs.banner_id = $1`,
    [bannerId]
  );
  const result = await client.query<{
    pool_active: boolean;
    card_id: string;
    card_active: boolean;
    card_deleted_at: Date | null;
    rarity_id: string;
    rarity_active: boolean;
    rarity_deleted_at: Date | null;
    rarity_sort_order: number;
    duplicate_tier: string | null;
    target_sort_order: number | null;
    card_reward_id: string | null;
    card_gold_amount: string | null;
    card_gems_amount: string | null;
    card_xp_amount: string | null;
    rarity_reward_id: string | null;
    rarity_gold_amount: string | null;
    rarity_gems_amount: string | null;
    rarity_xp_amount: string | null;
  }>(
    `SELECT banner_cards.active AS pool_active, cards.id AS card_id, cards.active AS card_active,
            cards.deleted_at AS card_deleted_at, cards.rarity_id,
            rarities.active AS rarity_active, rarities.deleted_at AS rarity_deleted_at,
            rarities.sort_order AS rarity_sort_order, rarities.duplicate_tier,
            card_reward.id AS card_reward_id,
            card_reward.gold_amount::text AS card_gold_amount,
            card_reward.gems_amount::text AS card_gems_amount,
            card_reward.xp_amount::text AS card_xp_amount,
            rarity_reward.id AS rarity_reward_id,
            rarity_reward.gold_amount::text AS rarity_gold_amount,
            rarity_reward.gems_amount::text AS rarity_gems_amount,
            rarity_reward.xp_amount::text AS rarity_xp_amount
     FROM invocation_banner_cards AS banner_cards
     JOIN cards ON cards.id = banner_cards.card_id
     JOIN rarities ON rarities.id = cards.rarity_id
     LEFT JOIN duplicate_reward_configs AS card_reward
       ON card_reward.card_id = cards.id
     LEFT JOIN duplicate_reward_configs AS rarity_reward
       ON rarity_reward.rarity_id = cards.rarity_id AND rarity_reward.card_id IS NULL
     WHERE banner_cards.banner_id = $1
     ORDER BY cards.id`,
    [bannerId]
  );
  const pool = result.rows;
  const pity = pityResult.rows[0];
  if (pity) {
    const hasEligibleTarget = pool.some((card) =>
      card.pool_active && card.card_active && !card.card_deleted_at
      && card.rarity_active && !card.rarity_deleted_at
      && card.rarity_sort_order >= pity.target_sort_order
    );
    if (!pity.target_rarity_active || pity.target_rarity_deleted_at || !hasEligibleTarget) {
      throw new AppError('A raridade de garantia precisa ter ao menos uma carta elegível no pool.', 409);
    }
  }

  if (!requirePublishable) return;
  const eligible = pool.filter((card) =>
    card.pool_active && card.card_active && !card.card_deleted_at
    && card.rarity_active && !card.rarity_deleted_at
  );
  if (!eligible.length) {
    throw new AppError('O banner precisa ter ao menos uma carta ativa para ser publicado.', 409);
  }

  const missingConversion = pool.find((card) =>
    card.pool_active && card.card_active && !card.card_deleted_at
    && card.rarity_active && !card.rarity_deleted_at
    && !card.card_reward_id && !card.rarity_reward_id
  );
  if (missingConversion) {
    throw new AppError(
      'Configure a conversão de duplicatas para cada raridade ou carta do pool antes de publicar o banner.',
      409
    );
  }

  const configuredCards = pool.filter((card) =>
    card.pool_active && card.card_active && !card.card_deleted_at
    && card.rarity_active && !card.rarity_deleted_at
  );
  for (const card of configuredCards) {
    const hasCardOverride = Boolean(card.card_reward_id);
    const gold = hasCardOverride ? card.card_gold_amount : card.rarity_gold_amount;
    const gems = hasCardOverride ? card.card_gems_amount : card.rarity_gems_amount;
    const xp = hasCardOverride ? card.card_xp_amount : card.rarity_xp_amount;
    if (gold === null || gems === null || xp === null) continue;
    assertDuplicateRewardPolicy(card.duplicate_tier, BigInt(gold), BigInt(gems), BigInt(xp), 409);
  }
}

export async function assertAffectedBannersRemainValid(
  client: PoolClient,
  cardId?: string,
  rarityId?: string
): Promise<void> {
  if (!cardId && !rarityId) return;
  const banners = await client.query<{ id: string }>(
    `SELECT DISTINCT invocation_banners.id
     FROM invocation_banners
     JOIN invocation_banner_cards ON invocation_banner_cards.banner_id = invocation_banners.id
     JOIN cards ON cards.id = invocation_banner_cards.card_id
     WHERE invocation_banners.active = true
       AND (($1::uuid IS NOT NULL AND cards.id = $1)
         OR ($2::uuid IS NOT NULL AND cards.rarity_id = $2))`,
    [cardId ?? null, rarityId ?? null]
  );
  for (const banner of banners.rows) {
    await assertBannerConfiguration(client, banner.id, true);
  }
}

export async function assertCardRarityCompatible(
  client: PoolClient,
  cardId: string,
  rarityId: string
): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM duplicate_reward_configs
     WHERE card_id = $1 AND rarity_id <> $2`,
    [cardId, rarityId]
  );
  if (result.rowCount) {
    throw new AppError('Atualize ou remova a sobrescrita de duplicata antes de alterar a raridade da carta.', 409);
  }
}

export async function assertRarityTierCompatible(
  client: PoolClient,
  rarityId: string,
  duplicateTier: string
): Promise<void> {
  if (['epic', 'legendary', 'secret'].includes(duplicateTier)) return;
  const result = await client.query(
    `SELECT 1
     FROM duplicate_reward_configs AS rewards
     LEFT JOIN cards ON cards.id = rewards.card_id
     WHERE rewards.gems_amount > 0
       AND (rewards.rarity_id = $1 OR cards.rarity_id = $1)
     LIMIT 1`,
    [rarityId]
  );
  if (result.rowCount) {
    throw new AppError('Remova as recompensas em gemas antes de classificar a raridade abaixo de Épica.', 409);
  }
}
