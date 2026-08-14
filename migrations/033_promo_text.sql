ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS headline   varchar(80),
    ADD COLUMN IF NOT EXISTS subtext    varchar(200),
    ADD COLUMN IF NOT EXISTS cta_label  varchar(40),
    ADD COLUMN IF NOT EXISTS bg_color   varchar(16) NOT NULL DEFAULT '#ffffff',
    ADD COLUMN IF NOT EXISTS layout     varchar(16) NOT NULL DEFAULT 'image';

ALTER TABLE promotions ALTER COLUMN image_url DROP NOT NULL;

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_layout_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_layout_check
    CHECK (layout IN ('image', 'text'));
