-- 138_variant_own_prices.sql
-- Per-variant prices (Ryan, Sept 2026): each colour/size variant can have
-- its own price. Vendors set a payout per variant and the commission
-- engine works out that variant's customer price, exactly as for the
-- product itself. Blank = the variant sells at the product's price.

BEGIN;

ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS vendor_payout NUMERIC(12,2)
    CHECK (vendor_payout IS NULL OR vendor_payout > 0);

INSERT INTO public.schema_migrations (filename, note)
VALUES ('138_variant_own_prices.sql', 'product_variants.vendor_payout - per-variant payout/price.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
