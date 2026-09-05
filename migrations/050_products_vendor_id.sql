-- 050_products_vendor_id.sql
-- Lets a product belong to a third-party vendor instead of (or alongside)
-- being created by staff. Nullable and additive: every existing product
-- keeps vendor_id NULL and behaves exactly as it does today.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS vendor_id INTEGER REFERENCES vendors(id);

CREATE INDEX IF NOT EXISTS idx_products_vendor_id
    ON products (vendor_id)
    WHERE vendor_id IS NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '050_products_vendor_id.sql',
    'products.vendor_id links a product to its vendor; used to scope the vendor portal to only that vendor''s own listings.'
)
ON CONFLICT (filename) DO NOTHING;
