-- 066_vendor_product_center.sql
-- Vendor Product Center enhancements (Task #60): a vendor-settable SKU
-- field, and an is_active toggle so a vendor can temporarily pull an
-- already-approved listing off the storefront (out of stock elsewhere,
-- seasonal, etc.) without deleting it or needing admin re-approval to
-- bring it back - re-approval only happens on a content EDIT (see
-- updateProduct's existing status='pending' reset), not a visibility
-- toggle.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS sku VARCHAR(64),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN products.sku IS
    'Vendor- or staff-supplied stock-keeping unit / internal product code. Free text, not validated for uniqueness - vendors run their own numbering.';
COMMENT ON COLUMN products.is_active IS
    'Vendor/staff-controlled visibility toggle, independent of the admin approval status column. An approved product with is_active=false is hidden from the public catalogue/storefront/product page exactly like a pending or rejected one, but keeps its approval and does not need re-review to reactivate.';

-- Cheap partial index: the only query pattern that cares about this column
-- is "find my inactive listings", a small minority of rows in practice.
CREATE INDEX IF NOT EXISTS idx_products_inactive ON products (vendor_id) WHERE is_active = false;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '066_vendor_product_center.sql',
    'products.sku (free-text vendor SKU) and products.is_active (vendor-controlled storefront visibility toggle, separate from admin approval status).'
)
ON CONFLICT (filename) DO NOTHING;
