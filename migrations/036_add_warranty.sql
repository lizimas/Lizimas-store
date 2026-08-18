-- 036_add_warranty.sql
-- Optional manufacturer warranty length in months. NULL/0 means "not shown" -
-- the storefront only renders the warranty badge when a value is set, so
-- existing products with no warranty data simply show nothing extra.

ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_months integer;
