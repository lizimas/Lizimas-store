-- 034_promo_strip.sql
-- Adds slot 3 (the announcement strip) and its two layouts.
--   strip_text : scrolling announcement, not tappable. Uses headline + subtext.
--   strip_link : fixed tile with an image and a label. Uses title, image_url, link_url.
-- No new columns: slot 3 reuses the existing promotions fields.

BEGIN;

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_slot_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_slot_check CHECK (slot = ANY (ARRAY[1, 2, 3]));

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_layout_check;
ALTER TABLE promotions
    ADD CONSTRAINT promotions_layout_check
    CHECK (layout IN ('image', 'text', 'strip_text', 'strip_link'));

COMMIT;
