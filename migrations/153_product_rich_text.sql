-- 153_product_rich_text.sql
-- Product form (Oct 2026): the Product description, Highlights, What's in
-- the box and Product warranty are written in a rich text editor. The
-- sanitised HTML is kept here; products.description stays the plain text of
-- the description (search, Google feed, page descriptions).
-- Also Model, Production country and Condition (New / Pre-Used / Refurbished).

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS description_html TEXT,
    ADD COLUMN IF NOT EXISTS highlights_html TEXT,
    ADD COLUMN IF NOT EXISTS box_contents_html TEXT,
    ADD COLUMN IF NOT EXISTS warranty_html TEXT,
    ADD COLUMN IF NOT EXISTS model TEXT,
    ADD COLUMN IF NOT EXISTS production_country TEXT,
    ADD COLUMN IF NOT EXISTS item_condition VARCHAR(20);

INSERT INTO public.schema_migrations (filename, note)
VALUES ('153_product_rich_text.sql', 'products.description_html/highlights_html/box_contents_html/warranty_html, model, production_country, item_condition.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
