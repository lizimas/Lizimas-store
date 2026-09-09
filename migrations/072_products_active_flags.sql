BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS admin_restricted BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_is_active
  ON public.products (is_active) WHERE is_active = false;

COMMENT ON COLUMN public.products.is_active IS
    'Vendor-controlled visibility toggle. Vendors flip this from their dashboard to pull a product off the storefront without deleting it.';

COMMENT ON COLUMN public.products.admin_restricted IS
    'Admin compliance block. Independent of the vendor is_active toggle so a vendor cannot re-list a product Lizimas has restricted.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '072_products_active_flags.sql',
    'Adds products.is_active and products.admin_restricted. Both were referenced by productController listing/detail queries since the vendor marketplace work but never created, 500ing every product query in production.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
