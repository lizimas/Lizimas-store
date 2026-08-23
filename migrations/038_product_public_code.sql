-- 038: public product code for URLs (nullable; backfilled later)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS public_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_public_code_key
  ON products (public_code)
  WHERE public_code IS NOT NULL;
