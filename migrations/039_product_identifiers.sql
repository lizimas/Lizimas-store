-- 039: brand and product identifiers for Google Shopping feed
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS brand VARCHAR(100),
  ADD COLUMN IF NOT EXISTS gtin  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS mpn   VARCHAR(70);

CREATE INDEX IF NOT EXISTS idx_products_brand ON products (brand) WHERE brand IS NOT NULL;
