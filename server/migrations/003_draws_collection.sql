CREATE TABLE draw_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  quantity SMALLINT NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_cost BIGINT NOT NULL CHECK (unit_cost > 0),
  total_cost BIGINT NOT NULL CHECK (total_cost > 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX draw_batches_user_created_idx ON draw_batches (user_id, created_at DESC);

CREATE TABLE draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES draw_batches(id),
  user_id UUID NOT NULL REFERENCES users(id),
  card_id UUID NOT NULL REFERENCES cards(id),
  rarity_id UUID NOT NULL REFERENCES rarities(id),
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 10),
  card_name TEXT NOT NULL,
  rarity_name TEXT NOT NULL,
  rarity_color_primary TEXT NOT NULL,
  rarity_color_secondary TEXT NOT NULL,
  animation_level SMALLINT NOT NULL CHECK (animation_level BETWEEN 1 AND 4),
  image_path TEXT,
  nominal_card_chance DOUBLE PRECISION NOT NULL CHECK (nominal_card_chance >= 0),
  nominal_rarity_chance DOUBLE PRECISION NOT NULL CHECK (nominal_rarity_chance >= 0),
  effective_card_chance DOUBLE PRECISION NOT NULL CHECK (effective_card_chance > 0),
  effective_rarity_chance DOUBLE PRECISION NOT NULL CHECK (effective_rarity_chance > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, position)
);

CREATE INDEX draws_user_created_idx ON draws (user_id, created_at DESC, id DESC);
CREATE INDEX draws_user_rarity_created_idx ON draws (user_id, rarity_id, created_at DESC);
CREATE INDEX draws_rarity_created_idx ON draws (rarity_id, created_at DESC);

CREATE TABLE user_cards (
  user_id UUID NOT NULL REFERENCES users(id),
  card_id UUID NOT NULL REFERENCES cards(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity > 0),
  first_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

CREATE INDEX user_cards_user_quantity_idx ON user_cards (user_id, quantity DESC);

