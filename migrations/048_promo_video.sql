-- 048_promo_video.sql
-- Lets a slot 4 row tile carry a video instead of a still image.
-- Additive only: every existing row keeps media_type 'image' and its
-- image_url, so nothing already on the homepage changes behaviour.

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image',
    ADD COLUMN IF NOT EXISTS video_url  TEXT,
    ADD COLUMN IF NOT EXISTS poster_url TEXT;

-- Dropped first so re-running the migration is safe.
ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS promotions_media_type_check;

ALTER TABLE promotions
    ADD CONSTRAINT promotions_media_type_check
    CHECK (media_type IN ('image', 'video'));

-- A video tile is meaningless without a source; an image tile must not
-- masquerade as one. Enforced here rather than only in the controller.
ALTER TABLE promotions
    DROP CONSTRAINT IF EXISTS promotions_video_url_check;

ALTER TABLE promotions
    ADD CONSTRAINT promotions_video_url_check
    CHECK (media_type <> 'video' OR video_url IS NOT NULL);

INSERT INTO schema_migrations (filename)
VALUES ('048_promo_video.sql')
ON CONFLICT DO NOTHING;
