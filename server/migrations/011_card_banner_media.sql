ALTER TABLE cards
  ADD COLUMN image_mime_type TEXT
    CHECK (image_mime_type IS NULL OR image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN image_width INTEGER CHECK (image_width IS NULL OR image_width > 0),
  ADD COLUMN image_height INTEGER CHECK (image_height IS NULL OR image_height > 0),
  ADD CONSTRAINT cards_image_dimensions_pair_check CHECK (
    (image_width IS NULL AND image_height IS NULL)
    OR (image_width IS NOT NULL AND image_height IS NOT NULL)
  ),
  ADD CONSTRAINT cards_image_metadata_without_path_check CHECK (
    image_path IS NOT NULL
    OR (image_mime_type IS NULL AND image_width IS NULL AND image_height IS NULL)
  ),
  ADD CONSTRAINT cards_image_metadata_complete_check CHECK (
    (image_mime_type IS NULL AND image_width IS NULL AND image_height IS NULL)
    OR (
      image_mime_type IS NOT NULL
      AND image_width IS NOT NULL
      AND image_height IS NOT NULL
    )
  );

ALTER TABLE invocation_banners
  ADD COLUMN image_path TEXT
    CHECK (image_path IS NULL OR image_path ~ '^/uploads/[0-9a-f-]+\.(jpg|png|webp|gif)$'),
  ADD COLUMN image_mime_type TEXT
    CHECK (image_mime_type IS NULL OR image_mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  ADD COLUMN image_width INTEGER CHECK (image_width IS NULL OR image_width > 0),
  ADD COLUMN image_height INTEGER CHECK (image_height IS NULL OR image_height > 0),
  ADD COLUMN fallback_image_path TEXT
    CHECK (fallback_image_path IS NULL OR fallback_image_path ~ '^/uploads/[0-9a-f-]+\.(jpg|png|webp)$'),
  ADD COLUMN fallback_image_mime_type TEXT
    CHECK (fallback_image_mime_type IS NULL OR fallback_image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD COLUMN fallback_image_width INTEGER CHECK (fallback_image_width IS NULL OR fallback_image_width > 0),
  ADD COLUMN fallback_image_height INTEGER CHECK (fallback_image_height IS NULL OR fallback_image_height > 0),
  ADD COLUMN image_focal_x SMALLINT NOT NULL DEFAULT 50 CHECK (image_focal_x BETWEEN 0 AND 100),
  ADD COLUMN image_focal_y SMALLINT NOT NULL DEFAULT 50 CHECK (image_focal_y BETWEEN 0 AND 100),
  ADD CONSTRAINT invocation_banner_image_dimensions_pair_check CHECK (
    (image_width IS NULL AND image_height IS NULL)
    OR (image_width IS NOT NULL AND image_height IS NOT NULL)
  ),
  ADD CONSTRAINT invocation_banner_image_metadata_check CHECK (
    (image_path IS NULL AND image_mime_type IS NULL AND image_width IS NULL AND image_height IS NULL)
    OR (
      image_path IS NOT NULL
      AND image_mime_type IS NOT NULL
      AND image_width IS NOT NULL
      AND image_height IS NOT NULL
    )
  ),
  ADD CONSTRAINT invocation_banner_fallback_dimensions_pair_check CHECK (
    (fallback_image_width IS NULL AND fallback_image_height IS NULL)
    OR (fallback_image_width IS NOT NULL AND fallback_image_height IS NOT NULL)
  ),
  ADD CONSTRAINT invocation_banner_fallback_metadata_check CHECK (
    (fallback_image_path IS NULL
      AND fallback_image_mime_type IS NULL
      AND fallback_image_width IS NULL
      AND fallback_image_height IS NULL)
    OR (
      fallback_image_path IS NOT NULL
      AND fallback_image_mime_type IS NOT NULL
      AND fallback_image_width IS NOT NULL
      AND fallback_image_height IS NOT NULL
    )
  ),
  ADD CONSTRAINT invocation_banner_fallback_metadata_without_path_check CHECK (
    fallback_image_path IS NOT NULL
    OR (
      fallback_image_mime_type IS NULL
      AND fallback_image_width IS NULL
      AND fallback_image_height IS NULL
    )
  ),
  ADD CONSTRAINT invocation_banner_gif_fallback_check CHECK (
    image_mime_type IS DISTINCT FROM 'image/gif'
    OR (
      image_path IS NOT NULL
      AND fallback_image_path IS NOT NULL
      AND fallback_image_mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND fallback_image_width IS NOT NULL
      AND fallback_image_height IS NOT NULL
    )
  );
