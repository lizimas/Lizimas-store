-- 146_product_sale_and_certifications.sql
-- Add Product form (Oct 2026, Ryan):
--  * Price / Sale Price / Sale Start Date / Sale End Date. The vendor types
--    their own amounts; Lizimas adds the commission. What they typed is kept
--    on the product (to refill the form); the customer-facing sale itself is
--    a vendor_promotions row with source = 'product_form', approved straight
--    away, so the store, the % off badge and checkout use the code that
--    already handles promotions.
--  * Certifications the product holds (optional).

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS sale_vendor_price NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS certifications TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.vendor_promotions
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'promotion';

COMMENT ON COLUMN public.vendor_promotions.source IS 'promotion = proposed on the Promotions page (reviewed by admin); product_form = Sale Price typed on the product form (approved automatically).';

INSERT INTO public.schema_migrations (filename, note)
VALUES ('146_product_sale_and_certifications.sql', 'products.sale_vendor_price/sale_starts_at/sale_ends_at/certifications; vendor_promotions.source.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
