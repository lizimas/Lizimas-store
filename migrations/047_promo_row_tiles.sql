-- 047_promo_row_tiles.sql
-- Adds slot 4 (promo tile inside a category product rail) and its layout.
--   row_tile : image tile pinned to a level-2 category. The rail becomes two
--              rows and the tile spans both, alternating side down the page.
-- New column: category_id, the pin. Null for every other slot.

BEGIN;

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_slot_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_slot_check CHECK (slot = ANY (ARRAY[1, 2, 3, 4]));

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_layout_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_layout_check
    CHECK (layout IN ('image', 'text', 'strip_text', 'strip_link', 'row_tile'));

ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS category_id INTEGER
    REFERENCES categories(id) ON DELETE SET NULL;

-- A row tile with no category has nowhere to render, so the pin is required
-- for that layout only. Other slots keep category_id null.
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_row_tile_category_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_row_tile_category_check
    CHECK (layout <> 'row_tile' OR category_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_promotions_category
    ON promotions (category_id) WHERE category_id IS NOT NULL;

INSERT INTO schema_migrations (filename)
VALUES ('047_promo_row_tiles.sql')
ON CONFLICT DO NOTHING;

COMMIT;
