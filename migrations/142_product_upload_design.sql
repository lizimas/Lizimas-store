-- 142_product_upload_design.sql
-- Add / Edit Product redesign (Ryan, Sept 2026).
--  * color_catalog.hex - each colour has a colour code (#RRGGBB) picked with
--    a colour picker, so swatches show the real colour. Admin creates and
--    edits colours; vendors only choose from the list. Common colour names
--    already in the list get a code below.
--  * product_colors.color_id - link to the colour list (the code already
--    writes it; IF NOT EXISTS keeps this safe where it exists).
--  * product_variants.sku - each variant can have its own SKU
--    (e.g. YD-8981-A for Black, YD-8981-B for Beige). Shown on the order so
--    the right item is picked.
--  * products.low_stock_threshold - the stock level that counts as "low"
--    for this product (low-stock alerts, the Low Stock filter). Blank = the
--    default of 10.
--  * products.compare_at_price - the "Was" price shown crossed out.
-- Safe to run more than once.

BEGIN;

ALTER TABLE public.color_catalog ADD COLUMN IF NOT EXISTS hex VARCHAR(7)
    CHECK (hex IS NULL OR hex ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE public.product_colors ADD COLUMN IF NOT EXISTS color_id INTEGER;

ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS sku VARCHAR(64);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER
    CHECK (low_stock_threshold IS NULL OR low_stock_threshold >= 0);

-- "Was" price (compare-at): shown crossed out beside the selling price with
-- the discount worked out, when no promotion or flash sale is running.
-- Admin / Lizimas Store products only. Blank = no "Was" price.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12,2)
    CHECK (compare_at_price IS NULL OR compare_at_price > 0);

-- Colour codes for common names (only where no code is set yet).
UPDATE public.color_catalog c SET hex = v.hex
  FROM (VALUES
    ('black', '#111111'), ('white', '#FFFFFF'), ('grey', '#9CA3AF'), ('gray', '#9CA3AF'),
    ('silver', '#C0C0C0'), ('red', '#DC2626'), ('maroon', '#7F1D1D'), ('pink', '#F472B6'),
    ('orange', '#F97316'), ('yellow', '#FACC15'), ('gold', '#D4AF37'), ('beige', '#E8DCC4'),
    ('cream', '#FFF8E1'), ('brown', '#8B5E3C'), ('khaki', '#C3B091'), ('green', '#16A34A'),
    ('olive', '#6B8E23'), ('mint', '#98FF98'), ('teal', '#0D9488'), ('blue', '#2563EB'),
    ('navy', '#1E3A8A'), ('navy blue', '#1E3A8A'), ('sky blue', '#7DD3FC'), ('light blue', '#93C5FD'),
    ('purple', '#7C3AED'), ('lilac', '#C8A2C8'), ('violet', '#8B5CF6'), ('transparent', '#E5E7EB'),
    ('clear', '#E5E7EB'), ('multicolor', '#A855F7'), ('multicolour', '#A855F7'), ('rose gold', '#B76E79'),
    ('jet black', '#0A0A0A'), ('charcoal', '#36454F'), ('dark grey', '#4B5563'), ('light grey', '#D1D5DB'),
    ('off white', '#FAF9F6'), ('ivory', '#FFFFF0'), ('taupe', '#8B8589'), ('tan', '#D2B48C'),
    ('camel', '#C19A6B'), ('light brown', '#B5835A'), ('dark brown', '#5C4033'), ('chocolate', '#7B3F00'),
    ('aqua', '#00FFFF'), ('turquoise', '#40E0D0'), ('royal blue', '#4169E1'), ('denim blue', '#1560BD'),
    ('deep blue', '#1E40AF'), ('sage', '#9CAF88'), ('light green', '#86EFAC'), ('emerald', '#10B981'),
    ('army green', '#4B5320'), ('dark green', '#14532D'), ('lemon', '#FFF44F'), ('mustard', '#E1AD01'),
    ('peach', '#FFCBA4'), ('coral', '#FF7F50'), ('light orange', '#FDBA74'), ('burnt orange', '#CC5500'),
    ('rust', '#B7410E'), ('light pink', '#FBCFE8'), ('hot pink', '#FF69B4'), ('fuchsia', '#D946EF'),
    ('rose', '#E11D48'), ('salmon', '#FA8072'), ('burgundy', '#800020'), ('dark red', '#8B0000'),
    ('wine', '#722F37'), ('lavender', '#E6E6FA'), ('plum', '#8E4585'), ('magenta', '#FF00FF'),
    ('champagne', '#F7E7CE'), ('bronze', '#CD7F32'), ('copper', '#B87333'), ('gunmetal', '#2A3439'),
    ('graphite', '#383838')
  ) AS v(name, hex)
 WHERE lower(trim(c.name)) = v.name AND c.hex IS NULL;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('142_product_upload_design.sql', 'Colour codes on the colour list, colour link on product colours, variant SKU, per-product low-stock level, compare-at (Was) price.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
