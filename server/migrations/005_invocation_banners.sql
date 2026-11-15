ALTER TABLE rarities
  ADD COLUMN duplicate_tier TEXT
    CHECK (duplicate_tier IS NULL OR duplicate_tier IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'secret'));

ALTER TABLE cards
  ADD COLUMN youtube_video_id TEXT
    CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  ADD COLUMN youtube_authorized_at TIMESTAMPTZ,
  ADD COLUMN youtube_authorized_by UUID REFERENCES users(id);

ALTER TABLE cards
  ADD CONSTRAINT cards_youtube_authorization_check CHECK (
    (youtube_video_id IS NULL AND youtube_authorized_at IS NULL AND youtube_authorized_by IS NULL)
    OR
    (youtube_video_id IS NOT NULL AND youtube_authorized_at IS NOT NULL AND youtube_authorized_by IS NOT NULL)
  );

ALTER TABLE draws
  DROP CONSTRAINT IF EXISTS draws_animation_level_check,
  ADD CONSTRAINT draws_animation_level_check CHECK (animation_level BETWEEN 1 AND 6),
  ADD COLUMN visual_effect TEXT NOT NULL DEFAULT 'glow'
    CHECK (visual_effect IN ('glow', 'particles', 'reveal', 'aura')),
  ADD COLUMN is_duplicate BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN duplicate_gold_amount BIGINT NOT NULL DEFAULT 0 CHECK (duplicate_gold_amount >= 0),
  ADD COLUMN duplicate_gems_amount BIGINT NOT NULL DEFAULT 0 CHECK (duplicate_gems_amount >= 0),
  ADD COLUMN duplicate_xp_amount BIGINT NOT NULL DEFAULT 0 CHECK (duplicate_xp_amount >= 0),
  ADD COLUMN collection_quantity INTEGER CHECK (collection_quantity IS NULL OR collection_quantity >= 1),
  ADD COLUMN youtube_video_id TEXT
    CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');

ALTER TABLE draw_batches
  ADD COLUMN banner_id UUID,
  ADD COLUMN banner_name TEXT,
  ADD COLUMN banner_config_version INTEGER;

CREATE TABLE invocation_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  active BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  time_zone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency TEXT NOT NULL CHECK (currency IN ('gold', 'gems')),
  unit_cost BIGINT NOT NULL CHECK (unit_cost > 0),
  quantity_options SMALLINT[] NOT NULL DEFAULT ARRAY[1, 10]::SMALLINT[],
  distribution_mode TEXT NOT NULL DEFAULT 'individual'
    CHECK (distribution_mode IN ('individual', 'rarity')),
  rarity_card_selection TEXT NOT NULL DEFAULT 'equal'
    CHECK (rarity_card_selection IN ('equal', 'weighted')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR starts_at < ends_at),
  CHECK (1 = ANY(quantity_options) AND 10 = ANY(quantity_options)),
  CHECK (cardinality(quantity_options) BETWEEN 2 AND 10)
);

CREATE INDEX invocation_banners_active_period_idx
  ON invocation_banners (active, starts_at, ends_at);

CREATE TABLE invocation_banner_cards (
  banner_id UUID NOT NULL REFERENCES invocation_banners(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id),
  weight BIGINT NOT NULL CHECK (weight > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (banner_id, card_id)
);

CREATE INDEX invocation_banner_cards_card_idx
  ON invocation_banner_cards (card_id, banner_id);

CREATE TABLE invocation_pity_configs (
  banner_id UUID PRIMARY KEY REFERENCES invocation_banners(id) ON DELETE CASCADE,
  rarity_id UUID NOT NULL REFERENCES rarities(id),
  soft_pity_start SMALLINT,
  soft_pity_increment_bps INTEGER NOT NULL DEFAULT 0
    CHECK (soft_pity_increment_bps BETWEEN 0 AND 10000),
  hard_pity_limit SMALLINT,
  CHECK (soft_pity_start IS NULL OR soft_pity_start >= 1),
  CHECK (hard_pity_limit IS NULL OR hard_pity_limit >= 1),
  CHECK ((soft_pity_start IS NULL AND soft_pity_increment_bps = 0)
    OR (soft_pity_start IS NOT NULL AND soft_pity_increment_bps > 0)),
  CHECK (hard_pity_limit IS NOT NULL OR soft_pity_start IS NOT NULL),
  CHECK (hard_pity_limit IS NULL OR soft_pity_start IS NULL OR soft_pity_start < hard_pity_limit)
);

CREATE TABLE user_banner_pity (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banner_id UUID NOT NULL REFERENCES invocation_banners(id) ON DELETE CASCADE,
  failures_count INTEGER NOT NULL DEFAULT 0 CHECK (failures_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, banner_id)
);

CREATE TABLE duplicate_reward_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rarity_id UUID NOT NULL REFERENCES rarities(id),
  card_id UUID REFERENCES cards(id),
  gold_amount BIGINT NOT NULL DEFAULT 0 CHECK (gold_amount >= 0),
  gems_amount BIGINT NOT NULL DEFAULT 0 CHECK (gems_amount >= 0),
  xp_amount BIGINT NOT NULL DEFAULT 0 CHECK (xp_amount >= 0),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (gold_amount > 0 OR gems_amount > 0 OR xp_amount > 0)
);

CREATE UNIQUE INDEX duplicate_reward_rarity_default_unique
  ON duplicate_reward_configs (rarity_id) WHERE card_id IS NULL;
CREATE UNIQUE INDEX duplicate_reward_card_override_unique
  ON duplicate_reward_configs (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX duplicate_reward_rarity_idx
  ON duplicate_reward_configs (rarity_id, card_id);

ALTER TABLE draw_batches
  ADD CONSTRAINT draw_batches_banner_id_fkey
    FOREIGN KEY (banner_id) REFERENCES invocation_banners(id);

ALTER TABLE wallet_transactions
  DROP CONSTRAINT wallet_transactions_type_check,
  ADD CONSTRAINT wallet_transactions_type_check CHECK (
    type IN (
      'signup_bonus', 'daily_claim', 'draw_cost', 'admin_grant', 'admin_adjustment',
      'daily_reward', 'daily_streak_bonus', 'cosmetic_purchase', 'xp_award',
      'duplicate_conversion'
    )
  );

CREATE INDEX draws_batch_banner_idx ON draws (batch_id, position);
