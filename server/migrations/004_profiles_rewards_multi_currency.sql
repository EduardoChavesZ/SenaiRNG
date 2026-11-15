ALTER TABLE wallets
  ADD COLUMN gems_balance BIGINT NOT NULL DEFAULT 0 CHECK (gems_balance >= 0),
  ADD COLUMN xp_balance BIGINT NOT NULL DEFAULT 0 CHECK (xp_balance >= 0);

ALTER TABLE wallet_transactions
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'gold';
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_currency_check CHECK (currency IN ('gold', 'gems', 'xp'));
ALTER TABLE wallet_transactions
  DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_type_check CHECK (
    type IN (
      'signup_bonus', 'daily_claim', 'draw_cost', 'admin_grant', 'admin_adjustment',
      'daily_reward', 'daily_streak_bonus', 'cosmetic_purchase', 'xp_award'
    )
  );

ALTER TABLE draw_batches
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'gold',
  ADD CONSTRAINT draw_batches_currency_check CHECK (currency IN ('gold', 'gems'));

ALTER TABLE draws
  ADD COLUMN effective_card_numerator TEXT,
  ADD COLUMN effective_card_denominator TEXT;

ALTER TABLE rarities DROP CONSTRAINT IF EXISTS rarities_animation_level_check;
ALTER TABLE rarities
  ADD CONSTRAINT rarities_animation_level_check CHECK (animation_level BETWEEN 1 AND 6);

CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('draw_count', 'unique_cards', 'streak', 'level')),
  requirement_value INTEGER NOT NULL CHECK (requirement_value > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX user_achievements_user_unlocked_idx
  ON user_achievements (user_id, unlocked_at DESC);

CREATE TABLE cosmetic_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'banner', 'frame', 'effect', 'title')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  preview_primary TEXT NOT NULL DEFAULT '#FF4100' CHECK (preview_primary ~ '^#[0-9a-fA-F]{6}$'),
  preview_secondary TEXT NOT NULL DEFAULT '#1A34AE' CHECK (preview_secondary ~ '^#[0-9a-fA-F]{6}$'),
  price_amount BIGINT NOT NULL DEFAULT 0 CHECK (price_amount >= 0),
  price_currency TEXT NOT NULL DEFAULT 'gold' CHECK (price_currency IN ('gold', 'gems')),
  required_level INTEGER NOT NULL DEFAULT 1 CHECK (required_level >= 1),
  required_achievement_key TEXT REFERENCES achievements(key),
  active BOOLEAN NOT NULL DEFAULT true,
  consumable BOOLEAN NOT NULL DEFAULT false CHECK (consumable = false),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cosmetic_items_active_kind_idx ON cosmetic_items (kind, active, name);

CREATE TABLE user_cosmetic_items (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES cosmetic_items(id),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acquired_via TEXT NOT NULL DEFAULT 'purchase'
    CHECK (acquired_via IN ('purchase', 'achievement', 'event', 'starter')),
  idempotency_key UUID,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX user_cosmetic_items_user_acquired_idx
  ON user_cosmetic_items (user_id, acquired_at DESC);
CREATE UNIQUE INDEX user_cosmetic_items_request_unique
  ON user_cosmetic_items (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE user_profile_customizations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 240),
  color_primary TEXT NOT NULL DEFAULT '#FF4100' CHECK (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_secondary TEXT NOT NULL DEFAULT '#1A34AE' CHECK (color_secondary ~ '^#[0-9a-fA-F]{6}$'),
  theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
  avatar_item_id UUID REFERENCES cosmetic_items(id) ON DELETE SET NULL,
  banner_item_id UUID REFERENCES cosmetic_items(id) ON DELETE SET NULL,
  frame_item_id UUID REFERENCES cosmetic_items(id) ON DELETE SET NULL,
  title_item_id UUID REFERENCES cosmetic_items(id) ON DELETE SET NULL,
  featured_card_id UUID REFERENCES cards(id) ON DELETE SET NULL,
  nickname_changed_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01 00:00:00+00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_profile_nickname_unique ON user_profile_customizations (lower(nickname));

INSERT INTO user_profile_customizations (user_id, nickname)
SELECT id, 'Jogador-' || substr(id::text, 1, 8)
FROM users
ON CONFLICT (user_id) DO NOTHING;

CREATE FUNCTION create_default_user_profile() RETURNS trigger AS $$
BEGIN
  INSERT INTO user_profile_customizations (user_id, nickname)
  VALUES (NEW.id, 'Jogador-' || substr(NEW.id::text, 1, 8))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_create_default_profile
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_user_profile();

CREATE TABLE daily_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL CHECK (currency IN ('gold', 'gems', 'xp')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  weight BIGINT NOT NULL CHECK (weight > 0),
  color_primary TEXT NOT NULL DEFAULT '#FF4100' CHECK (color_primary ~ '^#[0-9a-fA-F]{6}$'),
  color_secondary TEXT NOT NULL DEFAULT '#1A34AE' CHECK (color_secondary ~ '^#[0-9a-fA-F]{6}$'),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX daily_rewards_active_order_idx ON daily_rewards (active, sort_order);

CREATE TABLE daily_streak_milestones (
  consecutive_days INTEGER PRIMARY KEY CHECK (consecutive_days > 0),
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('gold', 'gems', 'xp')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_streaks (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  last_claim_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_reward_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_date DATE NOT NULL,
  idempotency_key UUID NOT NULL,
  reward_id UUID REFERENCES daily_rewards(id) ON DELETE SET NULL,
  reward_name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('gold', 'gems', 'xp')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  streak_days INTEGER NOT NULL CHECK (streak_days > 0),
  streak_bonus_name TEXT,
  streak_bonus_currency TEXT CHECK (streak_bonus_currency IN ('gold', 'gems', 'xp')),
  streak_bonus_amount BIGINT NOT NULL DEFAULT 0 CHECK (streak_bonus_amount >= 0),
  transaction_id UUID NOT NULL REFERENCES wallet_transactions(id),
  streak_bonus_transaction_id UUID REFERENCES wallet_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, claim_date),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX daily_reward_history_user_created_idx
  ON daily_reward_history (user_id, created_at DESC, id DESC);

CREATE TABLE user_game_stats (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_draws BIGINT NOT NULL DEFAULT 0 CHECK (total_draws >= 0),
  unique_cards INTEGER NOT NULL DEFAULT 0 CHECK (unique_cards >= 0),
  draws_by_rarity JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO user_game_stats (user_id, total_draws, unique_cards)
SELECT users.id, COALESCE(draw_stats.total_draws, 0), COALESCE(card_stats.unique_cards, 0)
FROM users
LEFT JOIN (
  SELECT user_id, COUNT(*) AS total_draws
  FROM draws
  GROUP BY user_id
) AS draw_stats ON draw_stats.user_id = users.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS unique_cards
  FROM user_cards
  GROUP BY user_id
) AS card_stats ON card_stats.user_id = users.id
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO achievements (key, name, description, requirement_type, requirement_value) VALUES
  ('first_draw', 'Primeiro sorteio', 'Realize seu primeiro sorteio.', 'draw_count', 1),
  ('collector_10', 'Colecionador', 'Descubra 10 cartas diferentes.', 'unique_cards', 10),
  ('streak_7', 'Uma semana presente', 'Mantenha uma sequência diária de 7 dias.', 'streak', 7);

INSERT INTO cosmetic_items
  (slug, kind, name, description, preview_primary, preview_secondary, price_amount, price_currency, required_level)
VALUES
  ('avatar-classic', 'avatar', 'Avatar clássico', 'Uma identidade simples com as cores da plataforma.', '#FF4100', '#1A34AE', 0, 'gold', 1),
  ('banner-senai', 'banner', 'Faixa SorteSenai', 'Um banner em vermelho e azul para o seu perfil.', '#FF4100', '#1A34AE', 50, 'gold', 1),
  ('frame-ruby', 'frame', 'Moldura rubi', 'Uma moldura de destaque para o avatar.', '#FF4100', '#B91600', 100, 'gold', 2),
  ('title-beginner', 'title', 'Iniciante', 'Título para quem está começando.', '#FF4100', '#1A34AE', 0, 'gold', 1),
  ('title-collector', 'title', 'Colecionador', 'Título para colecionadores dedicados.', '#1A34AE', '#FF4100', 250, 'gold', 3);

INSERT INTO daily_rewards
  (name, description, currency, amount, weight, color_primary, color_secondary, sort_order)
VALUES
  ('50 Gold', 'Recompensa diária', 'gold', 50, 4000, '#FF4100', '#B91600', 1),
  ('100 Gold', 'Recompensa diária', 'gold', 100, 2500, '#FF4100', '#1A34AE', 2),
  ('250 Gold', 'Recompensa diária', 'gold', 250, 1500, '#1A34AE', '#FF4100', 3),
  ('50 XP', 'Experiência para evoluir', 'xp', 50, 1000, '#1A34AE', '#243FBE', 4),
  ('1 Gem', 'Moeda especial', 'gems', 1, 500, '#1A34AE', '#FF4100', 5),
  ('3 Gems', 'Moedas especiais', 'gems', 3, 300, '#1A34AE', '#243FBE', 6),
  ('500 Gold', 'Recompensa especial', 'gold', 500, 200, '#FF4100', '#1A34AE', 7);

INSERT INTO settings (key, value) VALUES
  ('draw_currency', '"gold"'),
  ('draw_cost_gems', '1'),
  ('draw_event_enabled', 'false'),
  ('draw_event_discount_percent', '0'),
  ('draw_event_starts_at', 'null'),
  ('draw_event_ends_at', 'null'),
  ('daily_reward_timezone', '"America/Sao_Paulo"'),
  ('nickname_change_cooldown_days', '7'),
  ('xp_per_draw', '0'),
  ('xp_per_level', '100')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value)
SELECT 'draw_cost_gold', COALESCE((SELECT value FROM settings WHERE key = 'draw_cost'), '10'::jsonb)
ON CONFLICT (key) DO NOTHING;
