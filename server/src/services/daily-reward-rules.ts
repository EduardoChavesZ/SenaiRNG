export const DAILY_REWARD_COOLDOWN_MS = 60 * 60 * 1000;
export const DAILY_STREAK_PERIOD_MS = 24 * 60 * 60 * 1000;

export interface DailyStreakState {
  currentStreak: number;
  bestStreak: number;
  lastClaimAt: Date | null;
  lastStreakAt: Date | null;
}

export interface DailyStreakProgress {
  streakDays: number;
  bestStreak: number;
  lastStreakAt: Date;
  advanced: boolean;
}

export function getNextDailyRewardAt(lastClaimAt: Date | null, now: Date): Date {
  return lastClaimAt
    ? new Date(lastClaimAt.getTime() + DAILY_REWARD_COOLDOWN_MS)
    : now;
}

export function canClaimDailyReward(lastClaimAt: Date | null, now: Date, isAdmin: boolean): boolean {
  return isAdmin || now.getTime() >= getNextDailyRewardAt(lastClaimAt, now).getTime();
}

export function getDailyStreakProgress(
  previous: DailyStreakState | null,
  now: Date
): DailyStreakProgress {
  if (
    !previous
    || !previous.lastClaimAt
    || !previous.lastStreakAt
    || now.getTime() - previous.lastClaimAt.getTime() > DAILY_STREAK_PERIOD_MS
  ) {
    const streakDays = 1;
    return {
      streakDays,
      bestStreak: Math.max(previous?.bestStreak ?? 0, streakDays),
      lastStreakAt: now,
      advanced: true
    };
  }

  if (now.getTime() - previous.lastStreakAt.getTime() >= DAILY_STREAK_PERIOD_MS) {
    const streakDays = previous.currentStreak + 1;
    return {
      streakDays,
      bestStreak: Math.max(previous.bestStreak, streakDays),
      lastStreakAt: new Date(previous.lastStreakAt.getTime() + DAILY_STREAK_PERIOD_MS),
      advanced: true
    };
  }

  return {
    streakDays: previous.currentStreak,
    bestStreak: previous.bestStreak,
    lastStreakAt: previous.lastStreakAt,
    advanced: false
  };
}
