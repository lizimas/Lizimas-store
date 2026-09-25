-- 131_product_description_text.sql
-- Longer product descriptions (Ryan, Sept 2026 - vendors, staff and admin).
-- Makes sure products.description is unlimited TEXT whatever it was created
-- as (widening VARCHAR -> TEXT never loses data). Rich-content caption and
-- link-label limits were raised in descriptionBlockController.js, and the
-- JSON body limit in server/app.js went from 100kb to 5mb.

BEGIN;

ALTER TABLE products ALTER COLUMN description TYPE TEXT;

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '131_product_description_text.sql',
    'products.description is TEXT (no length cap).'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
