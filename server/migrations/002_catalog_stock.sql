CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX categories_name_unique ON categories (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE rarities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color_primary TEXT NOT NULL DEFAULT '#9b84ff',
  color_secondary TEXT NOT NULL DEFAULT '#211e30',
  visual_effect TEXT NOT NULL DEFAULT 'glow',
  animation_level SMALLINT NOT NULL DEFAULT 1 CHECK (animation_level BETWEEN 1 AND 4),
  sort_order INTEGER NOT NULL DEFAULT 0,
  weight BIGINT NOT NULL DEFAULT 1 CHECK (weight > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX rarities_name_unique ON rarities (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX rarities_active_order_idx ON rarities (active, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  image_path TEXT,
  description TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES categories(id),
  rarity_id UUID NOT NULL REFERENCES rarities(id),
  weight BIGINT NOT NULL DEFAULT 1 CHECK (weight > 0),
  stock_current INTEGER CHECK (stock_current IS NULL OR stock_current >= 0),
  stock_initial INTEGER CHECK (stock_initial IS NULL OR stock_initial >= 0),
  max_quantity INTEGER CHECK (max_quantity IS NULL OR max_quantity >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX cards_eligible_idx ON cards (rarity_id, id)
  WHERE active = true AND deleted_at IS NULL;
CREATE INDEX cards_category_active_idx ON cards (category_id, active)
  WHERE deleted_at IS NULL;

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id),
  type TEXT NOT NULL CHECK (type IN ('draw', 'manual_adjustment', 'restock')),
  change_amount INTEGER,
  quantity_before INTEGER,
  quantity_after INTEGER,
  actor_user_id UUID REFERENCES users(id),
  reference_type TEXT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX stock_movements_card_created_idx ON stock_movements (card_id, created_at DESC);
CREATE INDEX stock_movements_actor_created_idx ON stock_movements (actor_user_id, created_at DESC);

