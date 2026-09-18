-- 119_vendor_wizard_fields.sql
-- Adds the fields the Jumia-style 3-step Add Product wizard needs that
-- Lizimas didn't have yet (Ryan, Sept 2026 - vendor Add Product rebuild):
--   products.product_weight_kg, products.highlights - Step 1 "Product
--     Information" (products.color already existed - reused as-is, added
--     back in migrations_prod_sync.sql; product_weight_kg is already read
--     by productController.getProductOptions' DERIVED spec list, but was
--     never added by a tracked migration - this makes it official and
--     idempotent whether or not it already exists live).
--   product_variants.sku, product_variants.barcode - Step 2 "Variants",
--     alongside the price/stock columns that already existed.
-- All nullable/additive - no existing row, query or check constraint is
-- affected.

BEGIN;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS product_weight_kg NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS highlights TEXT;

ALTER TABLE product_variants
    ADD COLUMN IF NOT EXISTS sku VARCHAR(100),
    ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '119_vendor_wizard_fields.sql',
    'Vendor Add Product wizard: products.product_weight_kg/highlights, product_variants.sku/barcode.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
