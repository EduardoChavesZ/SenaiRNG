ALTER TABLE user_profile_customizations
  ADD COLUMN nickname_color TEXT NOT NULL DEFAULT '#1A34AE'
    CHECK (nickname_color ~ '^#[0-9a-fA-F]{6}$');
