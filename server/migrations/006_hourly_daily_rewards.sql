ALTER TABLE daily_streaks
  ADD COLUMN last_claim_at TIMESTAMPTZ,
  ADD COLUMN last_streak_at TIMESTAMPTZ;

UPDATE daily_streaks AS streak
SET last_claim_at = latest.created_at,
    last_streak_at = latest.created_at
FROM (
  SELECT user_id, MAX(created_at) AS created_at
  FROM daily_reward_history
  GROUP BY user_id
) AS latest
WHERE latest.user_id = streak.user_id;

ALTER TABLE daily_reward_history
  DROP CONSTRAINT IF EXISTS daily_reward_history_user_id_claim_date_key;

DELETE FROM settings WHERE key = 'daily_reward_timezone';

WITH legacy_colors AS (
  SELECT id, row_number() OVER (ORDER BY sort_order, id) - 1 AS color_index
  FROM daily_rewards
  WHERE color_primary IN ('#FF4100', '#1A34AE')
    AND color_secondary IN ('#B91600', '#1A34AE', '#FF4100', '#243FBE')
),
palette AS (
  SELECT * FROM (VALUES
    (0, '#7456D8'),
    (1, '#E56A66'),
    (2, '#E7AE4F'),
    (3, '#299C8E'),
    (4, '#527FD6'),
    (5, '#BC5E9D'),
    (6, '#D8754A')
  ) AS colors(color_index, color_primary)
)
UPDATE daily_rewards AS reward
SET color_primary = palette.color_primary,
    color_secondary = '#FFFFFF',
    updated_at = clock_timestamp()
FROM legacy_colors
JOIN palette ON palette.color_index = legacy_colors.color_index % 7
WHERE reward.id = legacy_colors.id;
