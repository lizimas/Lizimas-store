-- 055_promo_category_grid.sql
-- Adds two new promotion slots for standalone category grids on the
-- homepage (distinct from slot 4's row_tile, which pins inside a product
-- rail carousel):
--   slot 5 : category tile grid   ("Tech Store" style - small square tiles)
--   slot 6 : category banner grid ("Explore More Categories" style - large
--            rectangular cards)
-- Both slots share one layout, 'category_grid': an image, a category_id to
-- link to, and title used as the overlaid label text. The frontend decides
-- tile size purely from the slot number, same as row_tile does for slot 4.

BEGIN;

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_slot_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_slot_check CHECK (slot = ANY (ARRAY[1, 2, 3, 4, 5, 6]));

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_layout_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_layout_check
    CHECK (layout IN ('image', 'text', 'strip_text', 'strip_link', 'row_tile', 'category_grid'));

-- A category grid tile with no category has nowhere to link, so the pin is
-- required for this layout too (mirrors the row_tile rule from 047).
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_category_grid_category_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_category_grid_category_check
    CHECK (layout <> 'category_grid' OR category_id IS NOT NULL);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '055_promo_category_grid.sql',
  'Adds promotion slots 5 (category tile grid) and 6 (category banner grid) sharing a new category_grid layout, for standalone homepage category-browsing sections distinct from the slot-4 row tile.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
