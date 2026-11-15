import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_REWARD_COOLDOWN_MS,
  DAILY_STREAK_PERIOD_MS,
  canClaimDailyReward,
  getDailyStreakProgress,
  getNextDailyRewardAt
} from './daily-reward-rules.js';

const start = new Date('2026-01-01T12:00:00.000Z');

test('regular users can spin once per hour while admins bypass the cooldown', () => {
  const nextSpinAt = getNextDailyRewardAt(start, start);
  assert.equal(nextSpinAt.getTime(), start.getTime() + DAILY_REWARD_COOLDOWN_MS);
  assert.equal(canClaimDailyReward(start, new Date(start.getTime() + DAILY_REWARD_COOLDOWN_MS - 1), false), false);
  assert.equal(canClaimDailyReward(start, new Date(start.getTime() + DAILY_REWARD_COOLDOWN_MS), false), true);
  assert.equal(canClaimDailyReward(start, start, true), true);
});

test('hourly spins do not advance the streak until 24 real hours have passed', () => {
  const firstSpin = getDailyStreakProgress(null, start);
  assert.equal(firstSpin.streakDays, 1);
  assert.equal(firstSpin.advanced, true);

  const afterTwentyThreeHours = getDailyStreakProgress({
    currentStreak: firstSpin.streakDays,
    bestStreak: firstSpin.bestStreak,
    lastClaimAt: new Date(start.getTime() + 22 * DAILY_REWARD_COOLDOWN_MS),
    lastStreakAt: firstSpin.lastStreakAt
  }, new Date(start.getTime() + 23 * DAILY_REWARD_COOLDOWN_MS));
  assert.equal(afterTwentyThreeHours.streakDays, 1);
  assert.equal(afterTwentyThreeHours.advanced, false);

  const afterTwentyFourHours = getDailyStreakProgress({
    currentStreak: afterTwentyThreeHours.streakDays,
    bestStreak: afterTwentyThreeHours.bestStreak,
    lastClaimAt: new Date(start.getTime() + 23 * DAILY_REWARD_COOLDOWN_MS),
    lastStreakAt: afterTwentyThreeHours.lastStreakAt
  }, new Date(start.getTime() + DAILY_STREAK_PERIOD_MS));
  assert.equal(afterTwentyFourHours.streakDays, 2);
  assert.equal(afterTwentyFourHours.advanced, true);
});

test('a streak resets after more than 24 hours without a spin and preserves its best', () => {
  const progress = getDailyStreakProgress({
    currentStreak: 6,
    bestStreak: 8,
    lastClaimAt: start,
    lastStreakAt: start
  }, new Date(start.getTime() + DAILY_STREAK_PERIOD_MS + 1));

  assert.equal(progress.streakDays, 1);
  assert.equal(progress.bestStreak, 8);
  assert.equal(progress.advanced, true);
});
