import type { PoolClient } from 'pg';
import { getSetting } from './settings.js';
import { levelForXp } from './wallet.js';

export async function evaluateAchievements(client: PoolClient, userId: string): Promise<void> {
  const [stats, wallet, streak, achievements, xpPerLevel] = await Promise.all([
    client.query<{ total_draws: string; unique_cards: number }>(
      'SELECT total_draws::text, unique_cards FROM user_game_stats WHERE user_id = $1',
      [userId]
    ),
    client.query<{ xp_balance: string }>(
      'SELECT xp_balance::text FROM wallets WHERE user_id = $1',
      [userId]
    ),
    client.query<{ current_streak: number }>(
      'SELECT current_streak FROM daily_streaks WHERE user_id = $1',
      [userId]
    ),
    client.query<{
      id: string;
      requirement_type: 'draw_count' | 'unique_cards' | 'streak' | 'level';
      requirement_value: number;
    }>(
      `SELECT achievements.id, achievements.requirement_type, achievements.requirement_value
       FROM achievements
       WHERE NOT EXISTS (
         SELECT 1 FROM user_achievements
         WHERE user_achievements.user_id = $1
           AND user_achievements.achievement_id = achievements.id
       )`,
      [userId]
    ),
    getSetting<number>('xp_per_level', 100, client)
  ]);
  const userStats = stats.rows[0];
  const userWallet = wallet.rows[0];
  if (!userStats || !userWallet) return;
  const metrics = {
    draw_count: Number(userStats.total_draws),
    unique_cards: userStats.unique_cards,
    streak: streak.rows[0]?.current_streak ?? 0,
    level: levelForXp(BigInt(userWallet.xp_balance), xpPerLevel)
  };
  for (const achievement of achievements.rows) {
    if (metrics[achievement.requirement_type] < achievement.requirement_value) continue;
    await client.query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, achievement.id]
    );
  }
}
