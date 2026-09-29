-- 139_product_image_hash.sql
-- Vendor photo checks (Ryan, Sept 2026): a 64-bit perceptual hash of each
-- uploaded product photo, used to warn a vendor who reuses the same photo
-- on another listing. Filled for new uploads; older photos stay NULL.

BEGIN;

ALTER TABLE public.product_images ADD COLUMN IF NOT EXISTS phash VARCHAR(16);

INSERT INTO public.schema_migrations (filename, note)
VALUES ('139_product_image_hash.sql', 'product_images.phash - perceptual hash for duplicate photo warnings.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
