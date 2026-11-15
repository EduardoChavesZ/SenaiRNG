CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reduce_effects BOOLEAN NOT NULL DEFAULT false,
  invocation_music_enabled BOOLEAN NOT NULL DEFAULT false,
  sound_volume REAL NOT NULL DEFAULT 0.2 CHECK (sound_volume BETWEEN 0 AND 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO user_preferences (user_id)
SELECT id FROM users
ON CONFLICT (user_id) DO NOTHING;
