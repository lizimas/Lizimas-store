-- 081_vendor_shop_status.sql
-- Whole-shop visibility controls for the vendor mobile app (Menu > Settings
-- > Seller Settings), matching Jumia's "Shop Activation" and "Holiday
-- Mode" screens. Both are new: the only is_active flag that existed before
-- this was per-PRODUCT (products.is_active, set by the vendor per listing),
-- never per-shop. shop_active is the vendor's own on/off switch for the
-- whole storefront (separate from vendors.status, which is Lizimas' own
-- approve/reject/suspend workflow - a vendor can turn shop_active back on
-- any time, but only Lizimas can change vendors.status).
--
-- Holiday Mode is a scheduled version of the same idea: instead of an
-- immediate on/off, the vendor picks a start and end date and every
-- product is delisted for that window only, then comes back automatically
-- - no cron job needed since server/controllers/productController.js and
-- getPublicStorefront check the date range directly on every read.

BEGIN;

ALTER TABLE public.vendors
    ADD COLUMN IF NOT EXISTS shop_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS holiday_mode_active BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS holiday_mode_start_date DATE,
    ADD COLUMN IF NOT EXISTS holiday_mode_end_date DATE;

COMMENT ON COLUMN public.vendors.shop_active IS
    'Vendor-controlled whole-shop on/off switch (Menu > Settings > Shop Activation). false hides every one of this vendor''s products from public listings/search/storefront, same as if each were individually deactivated. Distinct from vendors.status, which is Lizimas'' own approve/reject/suspend workflow.';

COMMENT ON COLUMN public.vendors.holiday_mode_active IS
    'true while the vendor has an active Holiday Mode window scheduled (start/end dates below). Products stay delisted only between holiday_mode_start_date and holiday_mode_end_date inclusive - see the gating condition in productController.js/getPublicStorefront.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '081_vendor_shop_status.sql',
    'Adds vendors.shop_active (whole-shop Shop Activation toggle) and vendors.holiday_mode_active/holiday_mode_start_date/holiday_mode_end_date (scheduled Holiday Mode), both net-new vendor-controlled visibility switches for the mobile vendor app''s Settings screen.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
