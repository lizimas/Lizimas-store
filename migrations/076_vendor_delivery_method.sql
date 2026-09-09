-- 076_vendor_delivery_method.sql
-- How a vendor fulfils orders, shown as a small badge on their public
-- storefront next to the business name (spec: "vendors should have their
-- business name and how they make delivery, cash on delivery or payment
-- first" - Ryan, Sept 2026). Additive/nullable: a vendor who hasn't picked
-- one yet just shows no badge, same pattern as logo/banner/about in
-- 062_vendor_storefront_fields.sql.

BEGIN;

ALTER TABLE public.vendors
    ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_delivery_method_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_delivery_method_check
      CHECK (delivery_method IS NULL OR delivery_method IN ('cash_on_delivery', 'payment_first'));
  END IF;
END $$;

COMMENT ON COLUMN public.vendors.delivery_method IS
    'How this vendor fulfils orders: cash_on_delivery (customer pays the rider on arrival) or payment_first (customer must pay before dispatch). Vendor-set from their dashboard, shown on the public storefront next to the business name. NULL until the vendor picks one - the storefront just hides the badge rather than guessing.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '076_vendor_delivery_method.sql',
    'Adds vendors.delivery_method (cash_on_delivery/payment_first), vendor-set, shown on the public storefront page next to the business name.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
