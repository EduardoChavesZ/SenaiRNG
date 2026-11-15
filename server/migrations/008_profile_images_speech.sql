ALTER TABLE user_profile_customizations
  ADD COLUMN avatar_image_path TEXT,
  ADD COLUMN banner_image_path TEXT,
  ADD COLUMN speech_text TEXT NOT NULL DEFAULT '' CHECK (length(speech_text) <= 120),
  ADD CONSTRAINT user_profile_avatar_image_owner_check CHECK (
    avatar_image_path IS NULL OR avatar_image_path ~* (
      '^/uploads/profiles/' || user_id::text || '/[0-9a-f-]{36}[.](jpg|png|webp|gif)$'
    )
  ),
  ADD CONSTRAINT user_profile_banner_image_owner_check CHECK (
    banner_image_path IS NULL OR banner_image_path ~* (
      '^/uploads/profiles/' || user_id::text || '/[0-9a-f-]{36}[.](jpg|png|webp|gif)$'
    )
  );
