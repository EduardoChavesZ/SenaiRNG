import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { inTransaction } from '../db/transaction.js';
import { AppError } from '../errors.js';
import { evaluateAchievements } from './achievements.js';
import { calculateCardProbabilities, calculateEffectiveCards, type EligibleCard, type EffectiveCard } from './probabilities.js';
import { calculateInvocationOdds, reduce, toNumber, type PityRule, type Rational } from './invocation.js';
import { chooseCard, weightedPick } from './draw-rng.js';
import { assertBannerConfiguration } from './invocation-config.js';
import { getSetting } from './settings.js';
import { insertWalletTransaction, lockWallet, setWalletBalance, type SpendableCurrency } from './wallet.js';

const maxBigInt = 9_223_372_036_854_775_807n;

type BannerRow = {
  id: string;
  name: string;
  active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  currency: SpendableCurrency;
  unit_cost: string;
  quantity_options: number[];
  distribution_mode: 'individual' | 'rarity';
  rarity_card_selection: 'equal' | 'weighted';
  version: number;
  database_now: Date;
};

type PoolCard = EligibleCard & {
  youtube_video_id: string | null;
  rarity_visual_effect: string;
  banner_card_active: boolean;
};

type PityRow = {
  rarity_id: string;
  rarity_name: string;
  target_sort_order: number;
  soft_pity_start: number | null;
  soft_pity_increment_bps: number;
  hard_pity_limit: number | null;
};

type DuplicateReward = {
  rarity_id: string;
  card_id: string | null;
  gold_amount: string;
  gems_amount: string;
  xp_amount: string;
};

type DrawRecord = {
  card: EffectiveCard;
  youtubeVideoId: string | null;
  visualEffect: string;
  nominalCardChance: number;
  nominalRarityChance: number;
  effectiveCardChance: Rational;
  effectiveRarityChance: Rational;
};

export async function executeInvocation(
  userId: string,
  bannerId: string,
  quantity: number,
  idempotencyKey: string
) {
  return inTransaction(async (client) => {
    const previous = await client.query<{
      id: string;
      status: string;
      quantity: number;
      banner_id: string | null;
    }>(
      `SELECT id, status, quantity, banner_id
       FROM draw_batches WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    if (previous.rows[0]) {
      return replayOrReject(client, previous.rows[0], userId, bannerId, quantity);
    }

    const bannerResult = await client.query<BannerRow>(
      `SELECT id, name, active, starts_at, ends_at, currency, unit_cost::text,
              quantity_options, distribution_mode, rarity_card_selection, version, now() AS database_now
       FROM invocation_banners WHERE id = $1 FOR SHARE`,
      [bannerId]
    );
    const banner = bannerResult.rows[0];
    if (!banner || !banner.active) throw new AppError('Este banner não está ativo.', 404);
    const now = new Date(banner.database_now).getTime();
    if (banner.starts_at && new Date(banner.starts_at).getTime() > now) {
      throw new AppError('Este banner ainda não está disponível.', 409);
    }
    if (banner.ends_at && new Date(banner.ends_at).getTime() <= now) {
      throw new AppError('O período deste banner foi encerrado.', 409);
    }
    if (!banner.quantity_options.includes(quantity)) {
      throw new AppError('Essa quantidade não está disponível neste banner.', 400);
    }

    const unitCost = BigInt(banner.unit_cost);
    const totalCost = unitCost * BigInt(quantity);
    const batchResult = await client.query<{ id: string }>(
      `INSERT INTO draw_batches (
         user_id, idempotency_key, quantity, unit_cost, total_cost, status, currency,
         banner_id, banner_name, banner_config_version
       ) VALUES ($1, $2, $3, $4, $5, 'processing', $6, $7, $8, $9)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [
        userId, idempotencyKey, quantity, unitCost.toString(), totalCost.toString(),
        banner.currency, banner.id, banner.name, banner.version
      ]
    );
    if (!batchResult.rows[0]) {
      const conflicted = await client.query<{
        id: string;
        status: string;
        quantity: number;
        banner_id: string | null;
      }>(
        `SELECT id, status, quantity, banner_id
         FROM draw_batches WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
        [userId, idempotencyKey]
      );
      if (!conflicted.rows[0]) throw new AppError('Não foi possível recuperar a solicitação anterior.', 503);
      return replayOrReject(client, conflicted.rows[0], userId, bannerId, quantity);
    }

    const batchId = batchResult.rows[0].id;
    await assertBannerConfiguration(client, bannerId, true);
    const balances = await lockWallet(client, userId);
    if (balances[banner.currency] < totalCost) {
      throw new AppError(`Saldo insuficiente em ${currencyName(banner.currency)}.`, 409);
    }
    const [poolResult, pityResult, ownedResult, rewardsResult, xpSetting] = await Promise.all([
      loadInvocationPool(client, bannerId, true),
      client.query<PityRow>(
        `SELECT config.rarity_id, rarity.name AS rarity_name, rarity.sort_order AS target_sort_order,
                config.soft_pity_start, config.soft_pity_increment_bps, config.hard_pity_limit
         FROM invocation_pity_configs AS config
         JOIN rarities AS rarity ON rarity.id = config.rarity_id
         WHERE config.banner_id = $1`,
        [bannerId]
      ),
      client.query<{ card_id: string; quantity: number }>(
        'SELECT card_id, quantity FROM user_cards WHERE user_id = $1 FOR UPDATE',
        [userId]
      ),
      loadDuplicateRewards(client, bannerId),
      getSetting<number>('xp_per_draw', 0, client)
    ]);
    const allPoolCards = poolResult.rows;
    const candidates = calculateEffectiveCards(
      allPoolCards,
      banner.distribution_mode,
      banner.rarity_card_selection
    );
    if (!candidates.length) throw new AppError('Não há cartas elegíveis neste banner.', 409);
    const pity = pityResult.rows[0] ?? null;
    const pityRule: PityRule | null = pity ? {
      targetSortOrder: pity.target_sort_order,
      softPityStart: pity.soft_pity_start,
      softPityIncrementBps: pity.soft_pity_increment_bps,
      hardPityLimit: pity.hard_pity_limit
    } : null;
    let pityFailures = 0;
    if (pity) {
      await client.query(
        `INSERT INTO user_banner_pity (user_id, banner_id) VALUES ($1, $2)
         ON CONFLICT (user_id, banner_id) DO NOTHING`,
        [userId, bannerId]
      );
      const state = await client.query<{ failures_count: number }>(
        `SELECT failures_count FROM user_banner_pity
         WHERE user_id = $1 AND banner_id = $2 FOR UPDATE`,
        [userId, bannerId]
      );
      pityFailures = state.rows[0]!.failures_count;
    }

    const ownedCards = new Set(ownedResult.rows.map((row) => row.card_id));
    const ownedQuantities = new Map(ownedResult.rows.map((row) => [row.card_id, row.quantity]));
    const duplicateConfig = new Map<string, DuplicateReward>();
    for (const reward of rewardsResult.rows) {
      duplicateConfig.set(reward.card_id ? `card:${reward.card_id}` : `rarity:${reward.rarity_id}`, reward);
    }
    const outcomes: DrawRecord[] = [];

    for (let position = 1; position <= quantity; position += 1) {
      const currentCandidates = calculateEffectiveCards(
        allPoolCards,
        banner.distribution_mode,
        banner.rarity_card_selection
      );
      if (!currentCandidates.length) {
        throw new AppError('Não há cartas elegíveis para concluir esta invocação.', 409);
      }
      const pityPosition = pity ? pityFailures + 1 : position;
      const odds = calculateInvocationOdds(
        currentCandidates,
        banner.distribution_mode,
        banner.rarity_card_selection,
        pityPosition,
        pityRule
      );
      if (odds.impossible) {
        throw new AppError('A garantia não pode ser cumprida com as cartas atualmente disponíveis. Nenhuma cobrança foi feita.', 409);
      }
      const selected = pityRule
        ? choosePityCard(currentCandidates, banner, odds, pityRule.targetSortOrder)
        : chooseCard(currentCandidates, banner.distribution_mode, banner.rarity_card_selection);
      const chance = odds.cardChances.get(selected.id);
      if (!chance) throw new AppError('Não foi possível calcular a probabilidade efetiva do resultado.', 503);
      const probability = calculateCardProbabilities(
        allPoolCards,
        banner.distribution_mode,
        banner.rarity_card_selection
      ).find((card) => card.id === selected.id);
      if (!probability) throw new AppError('A carta sorteada não pertence ao pool configurado.', 503);
      const effectiveRarityChance = sumRationals(
        currentCandidates
          .filter((card) => card.rarity_id === selected.rarity_id)
          .map((card) => odds.cardChances.get(card.id))
          .filter((value): value is Rational => Boolean(value))
      );
      const poolCard = allPoolCards.find((card) => card.id === selected.id);
      if (!poolCard) throw new AppError('A carta sorteada não pertence ao pool configurado.', 503);

      outcomes.push({
        card: selected,
        youtubeVideoId: poolCard.youtube_video_id,
        visualEffect: poolCard.rarity_visual_effect,
        nominalCardChance: probability.nominalCardChance,
        nominalRarityChance: probability.nominalRarityChance,
        effectiveCardChance: chance,
        effectiveRarityChance
      });
      if (pity && pityRule) {
        pityFailures = selected.rarity_sort_order >= pityRule.targetSortOrder
          ? 0
          : Math.min(pityFailures + 1, 2_147_483_647);
      }
    }

    if (!Number.isSafeInteger(xpSetting) || xpSetting < 0) {
      throw new AppError('A configuração de XP por sorteio está inválida.', 503);
    }
    const nextBalances = { ...balances };
    nextBalances[banner.currency] -= totalCost;
    await insertWalletTransaction(client, {
      userId,
      type: 'draw_cost',
      currency: banner.currency,
      amount: -totalCost,
      balanceAfter: nextBalances[banner.currency],
      referenceType: 'draw_batch',
      referenceId: batchId
    });

    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index]!;
      const cardId = outcome.card.id;
      const isDuplicate = ownedCards.has(cardId);
      const collectionQuantity: number | null = isDuplicate
        ? ownedQuantities.get(cardId) ?? null
        : 1;
      let duplicateReward = { gold: 0n, gems: 0n, xp: 0n };
      if (isDuplicate) {
        const reward = duplicateConfig.get(`card:${cardId}`)
          ?? duplicateConfig.get(`rarity:${outcome.card.rarity_id}`);
        if (!reward) {
          throw new AppError('A conversão desta duplicata não está configurada. Nenhuma cobrança foi feita.', 503);
        }
        duplicateReward = {
          gold: BigInt(reward.gold_amount),
          gems: BigInt(reward.gems_amount),
          xp: BigInt(reward.xp_amount)
        };
        for (const currency of ['gold', 'gems', 'xp'] as const) {
          const amount = duplicateReward[currency];
          if (amount === 0n) continue;
          nextBalances[currency] += amount;
          assertSafeWalletBalance(nextBalances[currency]);
        }
      } else {
        const inserted = await client.query(
          `INSERT INTO user_cards (user_id, card_id, quantity)
           VALUES ($1, $2, 1)
           ON CONFLICT (user_id, card_id) DO NOTHING
           RETURNING card_id`,
          [userId, cardId]
        );
        if (!inserted.rowCount) {
          throw new AppError('A coleção mudou durante a invocação. Tente novamente.', 409);
        }
        ownedCards.add(cardId);
        ownedQuantities.set(cardId, 1);
      }

      const drawId = randomUUID();
      await client.query(
        `INSERT INTO draws (
           id, batch_id, user_id, card_id, rarity_id, position, card_name, rarity_name,
           rarity_color_primary, rarity_color_secondary, animation_level, visual_effect, image_path,
           nominal_card_chance, nominal_rarity_chance, effective_card_chance, effective_rarity_chance,
           effective_card_numerator, effective_card_denominator, is_duplicate, collection_quantity,
           duplicate_gold_amount, duplicate_gems_amount, duplicate_xp_amount, youtube_video_id
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
           $18, $19, $20, $21, $22, $23, $24, $25
         )`,
        [
          drawId, batchId, userId, outcome.card.id, outcome.card.rarity_id, index + 1,
          outcome.card.name, outcome.card.rarity_name, outcome.card.rarity_color_primary,
          outcome.card.rarity_color_secondary, outcome.card.rarity_animation_level,
          outcome.visualEffect, outcome.card.image_path, outcome.nominalCardChance, outcome.nominalRarityChance,
          toNumber(outcome.effectiveCardChance), toNumber(outcome.effectiveRarityChance),
          outcome.effectiveCardChance.numerator.toString(),
          outcome.effectiveCardChance.denominator.toString(),
          isDuplicate, collectionQuantity, duplicateReward.gold.toString(), duplicateReward.gems.toString(),
          duplicateReward.xp.toString(), outcome.youtubeVideoId
        ]
      );
      if (isDuplicate) {
        for (const currency of ['gold', 'gems', 'xp'] as const) {
          const amount = duplicateReward[currency];
          if (amount === 0n) continue;
          await insertWalletTransaction(client, {
            userId,
            type: 'duplicate_conversion',
            currency,
            amount,
            balanceAfter: nextBalances[currency],
            referenceType: 'draw_duplicate',
            referenceId: `${drawId}:${currency}`
          });
        }
      }
    }

    if (xpSetting > 0) {
      const amount = BigInt(xpSetting) * BigInt(quantity);
      nextBalances.xp += amount;
      assertSafeWalletBalance(nextBalances.xp);
      await insertWalletTransaction(client, {
        userId,
        type: 'xp_award',
        currency: 'xp',
        amount,
        balanceAfter: nextBalances.xp,
        referenceType: 'draw_batch',
        referenceId: batchId
      });
    }
    for (const currency of ['gold', 'gems', 'xp'] as const) {
      await setWalletBalance(client, userId, currency, nextBalances[currency]);
    }
    await client.query(
      `UPDATE draw_batches SET status = 'completed', completed_at = now()
       WHERE id = $1`,
      [batchId]
    );
    if (pity) {
      await client.query(
        `UPDATE user_banner_pity SET failures_count = $3, updated_at = now()
         WHERE user_id = $1 AND banner_id = $2`,
        [userId, bannerId, pityFailures]
      );
    }
    await updateDrawStats(client, userId, outcomes);
    await evaluateAchievements(client, userId);
    return readCompletedInvocation(client, batchId, userId, false);
  });
}

export async function readInvocationByKey(userId: string, idempotencyKey: string) {
  return inTransaction(async (client) => {
    const result = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM draw_batches
       WHERE user_id = $1 AND idempotency_key = $2 FOR UPDATE`,
      [userId, idempotencyKey]
    );
    const batch = result.rows[0];
    if (!batch) throw new AppError('A solicitação não foi encontrada.', 404);
    if (batch.status !== 'completed') {
      throw new AppError('A solicitação ainda está sendo processada. Tente novamente em instantes.', 409);
    }
    return readCompletedInvocation(client, batch.id, userId, true);
  });
}

async function replayOrReject(
  client: PoolClient,
  previous: { id: string; status: string; quantity: number; banner_id: string | null },
  userId: string,
  bannerId: string,
  quantity: number
) {
  if (previous.quantity !== quantity || previous.banner_id !== bannerId) {
    throw new AppError('A chave de idempotência já foi usada com outro banner ou quantidade.', 409);
  }
  if (previous.status !== 'completed') {
    throw new AppError('Esta solicitação já está sendo processada. Tente novamente em instantes.', 409);
  }
  return readCompletedInvocation(client, previous.id, userId, true);
}

async function loadInvocationPool(client: PoolClient, bannerId: string, lock: boolean) {
  const result = await client.query<PoolCard>(
    `SELECT cards.id, cards.name, cards.image_path, cards.description,
            cards.category_id, categories.name AS category_name,
            rarities.id AS rarity_id, rarities.name AS rarity_name,
            rarities.color_primary AS rarity_color_primary,
            rarities.color_secondary AS rarity_color_secondary,
            rarities.animation_level AS rarity_animation_level,
            rarities.visual_effect AS rarity_visual_effect,
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
     ORDER BY cards.id${lock ? ' FOR UPDATE OF cards, rarities, banner_cards' : ''}`,
    [bannerId]
  );
  return result;
}

async function loadDuplicateRewards(client: PoolClient, bannerId: string) {
  return client.query<DuplicateReward>(
    `SELECT DISTINCT rewards.rarity_id, rewards.card_id,
            rewards.gold_amount::text, rewards.gems_amount::text, rewards.xp_amount::text
     FROM duplicate_reward_configs AS rewards
     WHERE rewards.rarity_id IN (
       SELECT cards.rarity_id
       FROM invocation_banner_cards AS banner_cards
       JOIN cards ON cards.id = banner_cards.card_id
       WHERE banner_cards.banner_id = $1
     )
     OR rewards.card_id IN (
       SELECT card_id FROM invocation_banner_cards WHERE banner_id = $1
     )`,
    [bannerId]
  );
}

function choosePityCard(
  cards: EffectiveCard[],
  banner: BannerRow,
  odds: ReturnType<typeof calculateInvocationOdds>,
  targetSortOrder: number
): EffectiveCard {
  const targetCards = cards.filter((card) => card.rarity_sort_order >= targetSortOrder);
  const lowerCards = cards.filter((card) => card.rarity_sort_order < targetSortOrder);
  const targetWeight = odds.targetChance.numerator;
  const lowerWeight = odds.targetChance.denominator - targetWeight;
  const choices = [
    ...(targetWeight > 0n ? [{ cards: targetCards, weight: targetWeight }] : []),
    ...(lowerWeight > 0n ? [{ cards: lowerCards, weight: lowerWeight }] : [])
  ];
  if (choices.some((choice) => choice.cards.length === 0)) {
    throw new AppError('A configuração de pity não pode ser cumprida com o pool atual.', 409);
  }
  const group = weightedPick(choices, (choice) => choice.weight);
  return chooseCard(group.cards, banner.distribution_mode, banner.rarity_card_selection);
}

async function readCompletedInvocation(
  client: PoolClient,
  batchId: string,
  userId: string,
  idempotentReplay: boolean
) {
  const [batchResult, drawsResult, walletResult, pityResult] = await Promise.all([
    client.query<{
      quantity: number;
      unit_cost: string;
      total_cost: string;
      currency: SpendableCurrency;
      banner_id: string | null;
      banner_name: string | null;
    }>(
      `SELECT quantity, unit_cost::text, total_cost::text, currency, banner_id, banner_name
       FROM draw_batches WHERE id = $1 AND user_id = $2`,
      [batchId, userId]
    ),
    client.query(
      `SELECT id, card_id, card_name, rarity_id, rarity_name, rarity_color_primary,
              rarity_color_secondary, animation_level, visual_effect, image_path, position, nominal_card_chance,
              nominal_rarity_chance, effective_card_chance, effective_rarity_chance,
              effective_card_numerator, effective_card_denominator, is_duplicate,
              collection_quantity,
              duplicate_gold_amount::text, duplicate_gems_amount::text, duplicate_xp_amount::text,
              youtube_video_id, created_at
       FROM draws WHERE batch_id = $1 ORDER BY position`,
      [batchId]
    ),
    client.query<{ balance: string; gems_balance: string; xp_balance: string }>(
      'SELECT balance::text, gems_balance::text, xp_balance::text FROM wallets WHERE user_id = $1',
      [userId]
    ),
    client.query<{ failures_count: number }>(
      `SELECT state.failures_count
       FROM draw_batches AS batch
       JOIN user_banner_pity AS state
         ON state.banner_id = batch.banner_id AND state.user_id = batch.user_id
       WHERE batch.id = $1`,
      [batchId]
    )
  ]);
  const batch = batchResult.rows[0];
  const wallet = walletResult.rows[0];
  if (!batch || !wallet) throw new AppError('O resultado da invocação não foi encontrado.', 404);
  const balances = {
    gold: Number(wallet.balance),
    gems: Number(wallet.gems_balance),
    xp: Number(wallet.xp_balance)
  };
  const balance = balances[batch.currency];
  return {
    batchId,
    bannerId: batch.banner_id,
    bannerName: batch.banner_name,
    quantity: batch.quantity,
    unitCost: Number(batch.unit_cost),
    totalCost: Number(batch.total_cost),
    balance,
    currency: batch.currency,
    wallet: balances,
    pity: pityResult.rows[0]
      ? { failures: pityResult.rows[0].failures_count, position: pityResult.rows[0].failures_count + 1 }
      : null,
    idempotentReplay,
    draws: drawsResult.rows
  };
}

async function updateDrawStats(
  client: PoolClient,
  userId: string,
  outcomes: DrawRecord[]
): Promise<void> {
  await client.query(
    `INSERT INTO user_game_stats (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  await client.query(
    `UPDATE user_game_stats SET
       total_draws = total_draws + $2,
       unique_cards = (SELECT COUNT(*) FROM user_cards WHERE user_id = $1),
       updated_at = now()
     WHERE user_id = $1`,
    [userId, outcomes.length]
  );
  for (const { card } of outcomes) {
    await client.query(
      `UPDATE user_game_stats SET
         draws_by_rarity = jsonb_set(
           draws_by_rarity,
           ARRAY[$2::text],
           to_jsonb(COALESCE((draws_by_rarity ->> $2::text)::integer, 0) + 1),
           true
         ),
         updated_at = now()
       WHERE user_id = $1`,
      [userId, card.rarity_id]
    );
  }
}

function sumRationals(values: Rational[]): Rational {
  return values.reduce((sum, value) => reduce({
    numerator: sum.numerator * value.denominator + value.numerator * sum.denominator,
    denominator: sum.denominator * value.denominator
  }), { numerator: 0n, denominator: 1n });
}

function assertSafeWalletBalance(balance: bigint): void {
  if (balance < 0n) throw new AppError('O saldo não pode ficar negativo.', 409);
  if (balance > maxBigInt) throw new AppError('A recompensa excede o limite permitido para a carteira.', 409);
}

function currencyName(currency: SpendableCurrency): string {
  return currency === 'gold' ? 'moedas' : 'gemas';
}
