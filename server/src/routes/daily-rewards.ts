import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { inTransaction } from '../db/transaction.js';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';
import { evaluateAchievements } from '../services/achievements.js';
import {
  canClaimDailyReward,
  DAILY_STREAK_PERIOD_MS,
  getDailyStreakProgress,
  getNextDailyRewardAt
} from '../services/daily-reward-rules.js';
import { weightedPick } from '../services/draw-rng.js';
import { getSetting } from '../services/settings.js';
import { insertWalletTransaction, levelForXp, lockWallet, setWalletBalance, type Currency } from '../services/wallet.js';

const router = Router();
const claimSchema = z.object({ idempotencyKey: z.string().uuid() });
const totalRewardWeight = 10_000n;

type RewardRow = {
  id: string;
  name: string;
  description: string;
  currency: Currency;
  amount: string;
  weight: string;
  color_primary: string;
  color_secondary: string;
  sort_order: number;
};
type WalletBalances = { gold: bigint; gems: bigint; xp: bigint };

router.use(requireAuth);

router.get('/options', asyncHandler(async (request, response) => {
  const [clock, rewards, streak, history] = await Promise.all([
    pool.query<{ server_now: Date; next_available_at: Date }>(
      `SELECT clock_timestamp() AS server_now,
              COALESCE(streak.last_claim_at + interval '1 hour', clock_timestamp()) AS next_available_at
       FROM (SELECT $1::uuid AS user_id) AS requested_user
       LEFT JOIN daily_streaks AS streak ON streak.user_id = requested_user.user_id`,
      [request.user!.id]
    ),
    pool.query<RewardRow>(
      `SELECT id, name, description, currency, amount::text, weight::text,
              color_primary, color_secondary, sort_order
       FROM daily_rewards WHERE active = true ORDER BY sort_order, id`
    ),
    pool.query<{
      current_streak: number;
      best_streak: number;
      last_claim_date: string | null;
      last_claim_at: Date | null;
      last_streak_at: Date | null;
    }>(
      `SELECT current_streak, best_streak, last_claim_date::text, last_claim_at, last_streak_at
       FROM daily_streaks WHERE user_id = $1`,
      [request.user!.id]
    ),
    pool.query(
      `SELECT id, reward_name, currency, amount::text, streak_days,
              streak_bonus_name, streak_bonus_currency, streak_bonus_amount::text, created_at
       FROM daily_reward_history
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 30`,
      [request.user!.id]
    )
  ]);
  const totalWeight = rewards.rows.reduce((sum, reward) => sum + BigInt(reward.weight), 0n);
  if (rewards.rows.length && totalWeight !== totalRewardWeight) {
    throw new AppError('A configuração da roleta diária está inválida. Avise um administrador.', 503);
  }
  const serverNow = clock.rows[0]!.server_now;
  const lastClaimAt = streak.rows[0]?.last_claim_at ?? null;
  const streakIsCurrent = lastClaimAt
    && serverNow.getTime() - lastClaimAt.getTime() <= DAILY_STREAK_PERIOD_MS;
  const currentStreak = streakIsCurrent ? streak.rows[0]!.current_streak : 0;
  const xpPerLevel = await getSetting<number>('xp_per_level', 100);
  const wallet = await pool.query<{ balance: string; gems_balance: string; xp_balance: string }>(
    'SELECT balance, gems_balance, xp_balance FROM wallets WHERE user_id = $1',
    [request.user!.id]
  );
  if (!wallet.rows[0]) throw new AppError('Carteira não encontrada.', 404);
  const balances = wallet.rows[0];

  response.json({
    serverNow,
    canClaim: canClaimDailyReward(lastClaimAt, serverNow, request.user!.role === 'admin'),
    nextAvailableAt: clock.rows[0]!.next_available_at,
    currentStreak,
    bestStreak: streak.rows[0]?.best_streak ?? 0,
    lastClaimDate: streak.rows[0]?.last_claim_date ?? null,
    level: levelForXp(BigInt(balances.xp_balance), xpPerLevel),
    wallet: {
      gold: Number(balances.balance),
      gems: Number(balances.gems_balance),
      xp: Number(balances.xp_balance)
    },
    rewards: rewards.rows.map((reward) => ({
      id: reward.id,
      name: reward.name,
      description: reward.description,
      currency: reward.currency,
      amount: Number(reward.amount),
      weight: Number(reward.weight),
      chanceNumerator: reward.weight,
      chanceDenominator: totalWeight.toString(),
      effectiveChance: Number(BigInt(reward.weight)) / Number(totalWeight),
      colorPrimary: reward.color_primary,
      colorSecondary: reward.color_secondary
    })),
    history: history.rows
  });
}));

router.post('/claim', asyncHandler(async (request, response) => {
  const input = claimSchema.parse(request.body);
  const claim = await inTransaction(async (client) => {
    const previousRequest = await client.query<{ id: string }>(
      `SELECT id FROM daily_reward_history
       WHERE user_id = $1 AND idempotency_key = $2`,
      [request.user!.id, input.idempotencyKey]
    );
    if (previousRequest.rows[0]) {
      return readClaim(client, previousRequest.rows[0].id, request.user!.id, true);
    }

    let balances: WalletBalances = await lockWallet(client, request.user!.id);
    const retriedRequest = await client.query<{ id: string }>(
      `SELECT id FROM daily_reward_history
       WHERE user_id = $1 AND idempotency_key = $2`,
      [request.user!.id, input.idempotencyKey]
    );
    if (retriedRequest.rows[0]) {
      return readClaim(client, retriedRequest.rows[0].id, request.user!.id, true);
    }

    const streakResult = await client.query<{
      current_streak: number;
      best_streak: number;
      last_claim_at: Date | null;
      last_streak_at: Date | null;
    }>(
      `SELECT current_streak, best_streak, last_claim_at, last_streak_at
       FROM daily_streaks WHERE user_id = $1 FOR UPDATE`,
      [request.user!.id]
    );
    const previousStreak = streakResult.rows[0];
    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const now = clock.rows[0]!.now;
    const lastClaimAt = previousStreak?.last_claim_at ?? null;
    const isAdmin = request.user!.role === 'admin';
    if (!canClaimDailyReward(lastClaimAt, now, isAdmin)) {
      throw new AppError('Você poderá girar novamente após completar 1 hora do último giro.', 409);
    }

    const streakProgress = getDailyStreakProgress(previousStreak ? {
      currentStreak: previousStreak.current_streak,
      bestStreak: previousStreak.best_streak,
      lastClaimAt: previousStreak.last_claim_at,
      lastStreakAt: previousStreak.last_streak_at
    } : null, now);
    const { streakDays, bestStreak, lastStreakAt } = streakProgress;
    const claimDate = now.toISOString().slice(0, 10);

    const configuredRewards = await client.query<RewardRow>(
      `SELECT id, name, description, currency, amount::text, weight::text,
              color_primary, color_secondary, sort_order
       FROM daily_rewards WHERE active = true ORDER BY sort_order, id FOR SHARE`
    );
    const weightSum = configuredRewards.rows.reduce((sum, reward) => sum + BigInt(reward.weight), 0n);
    if (!configuredRewards.rows.length || weightSum !== totalRewardWeight) {
      throw new AppError('A roleta diária está temporariamente indisponível.', 503);
    }
    const reward = weightedPick(configuredRewards.rows, (entry) => BigInt(entry.weight));

    let milestone: { name: string; currency: Currency; amount: string } | null = null;
    if (streakProgress.advanced) {
      const milestoneResult = await client.query<{ name: string; currency: Currency; amount: string }>(
        `SELECT name, currency, amount::text
         FROM daily_streak_milestones
         WHERE consecutive_days = $1 AND active = true`,
        [streakDays]
      );
      milestone = milestoneResult.rows[0] ?? null;
    }
    const claimId = randomUUID();
    const rewardCurrency = reward.currency;
    const rewardAmount = BigInt(reward.amount);
    const rewardAward = await grantCurrency(
      client, request.user!.id, balances, rewardCurrency, rewardAmount,
      'daily_reward', 'daily_reward', claimId
    );
    balances = rewardAward.balances;
    let bonusTransactionId: string | null = null;
    if (milestone) {
      const bonusAmount = BigInt(milestone.amount);
      const bonusAward = await grantCurrency(
        client, request.user!.id, balances, milestone.currency, bonusAmount,
        'daily_streak_bonus', 'daily_reward', claimId
      );
      balances = bonusAward.balances;
      bonusTransactionId = bonusAward.transactionId;
    }

    await client.query(
      `INSERT INTO daily_reward_history (
         id, user_id, claim_date, idempotency_key, reward_id, reward_name, currency, amount,
         streak_days, streak_bonus_name, streak_bonus_currency, streak_bonus_amount,
         transaction_id, streak_bonus_transaction_id, created_at
       ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        claimId, request.user!.id, claimDate, input.idempotencyKey, reward.id, reward.name,
        rewardCurrency, rewardAmount.toString(), streakDays,
        milestone?.name ?? null, milestone?.currency ?? null, milestone?.amount ?? 0,
        rewardAward.transactionId, bonusTransactionId, now
      ]
    );
    await client.query(
      `INSERT INTO daily_streaks (
         user_id, current_streak, best_streak, last_claim_date, last_claim_at, last_streak_at, updated_at
       ) VALUES ($1, $2, $3, $4::date, $5, $6, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         current_streak = EXCLUDED.current_streak,
         best_streak = EXCLUDED.best_streak,
         last_claim_date = EXCLUDED.last_claim_date,
         last_claim_at = EXCLUDED.last_claim_at,
         last_streak_at = EXCLUDED.last_streak_at,
         updated_at = EXCLUDED.updated_at`,
      [request.user!.id, streakDays, bestStreak, claimDate, now, lastStreakAt]
    );
    await client.query(
      `INSERT INTO user_game_stats (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [request.user!.id]
    );
    await client.query(
      `UPDATE user_game_stats SET updated_at = now() WHERE user_id = $1`,
      [request.user!.id]
    );
    await evaluateAchievements(client, request.user!.id);
    return {
      id: claimId,
      reward: {
        id: reward.id,
        name: reward.name,
        currency: rewardCurrency,
        amount: Number(rewardAmount),
        chanceNumerator: reward.weight,
        chanceDenominator: weightSum.toString()
      },
      streakDays,
      milestone: milestone ? {
        name: milestone.name,
        currency: milestone.currency,
        amount: Number(milestone.amount)
      } : null,
      wallet: {
        gold: Number(balances.gold),
        gems: Number(balances.gems),
        xp: Number(balances.xp)
      },
      nextAvailableAt: isAdmin ? now : getNextDailyRewardAt(now, now),
      idempotentReplay: false
    };
  });
  response.json(claim);
}));

async function grantCurrency(
  client: import('pg').PoolClient,
  userId: string,
  balances: WalletBalances,
  currency: Currency,
  amount: bigint,
  type: 'daily_reward' | 'daily_streak_bonus',
  referenceType: string,
  referenceId: string
): Promise<{ balances: WalletBalances; transactionId: string }> {
  const next = balances[currency] + amount;
  await setWalletBalance(client, userId, currency, next);
  const transactionId = await insertWalletTransaction(client, {
    userId, type, currency, amount, balanceAfter: next, referenceType, referenceId
  });
  return {
    balances: { ...balances, [currency]: next },
    transactionId
  };
}

async function readClaim(
  client: import('pg').PoolClient,
  claimId: string,
  userId: string,
  idempotentReplay: boolean
) {
  const [claimResult, walletResult, clock] = await Promise.all([
    client.query<{
      reward_id: string | null;
      reward_name: string;
      currency: Currency;
      amount: string;
      streak_days: number;
      streak_bonus_name: string | null;
      streak_bonus_currency: Currency | null;
      streak_bonus_amount: string;
      transaction_id: string;
    }>(
      `SELECT reward_id, reward_name, currency, amount::text, streak_days,
              streak_bonus_name, streak_bonus_currency, streak_bonus_amount::text, transaction_id
       FROM daily_reward_history WHERE id = $1 AND user_id = $2`,
      [claimId, userId]
    ),
    client.query<{ balance: string; gems_balance: string; xp_balance: string }>(
      'SELECT balance, gems_balance, xp_balance FROM wallets WHERE user_id = $1',
      [userId]
    ),
    client.query<{ next_available_at: Date }>(
      `SELECT COALESCE(streak.last_claim_at + interval '1 hour', clock_timestamp()) AS next_available_at
       FROM (SELECT $1::uuid AS user_id) AS requested_user
       LEFT JOIN daily_streaks AS streak ON streak.user_id = requested_user.user_id`,
      [userId]
    )
  ]);
  const claim = claimResult.rows[0];
  const wallet = walletResult.rows[0];
  if (!claim || !wallet) throw new AppError('O resultado diário não foi encontrado.', 404);
  return {
    id: claimId,
    reward: {
      id: claim.reward_id,
      name: claim.reward_name,
      currency: claim.currency,
      amount: Number(claim.amount)
    },
    streakDays: claim.streak_days,
    milestone: claim.streak_bonus_name ? {
      name: claim.streak_bonus_name,
      currency: claim.streak_bonus_currency,
      amount: Number(claim.streak_bonus_amount)
    } : null,
    wallet: {
      gold: Number(wallet.balance),
      gems: Number(wallet.gems_balance),
      xp: Number(wallet.xp_balance)
    },
    nextAvailableAt: clock.rows[0]!.next_available_at,
    idempotentReplay
  };
}

export default router;
