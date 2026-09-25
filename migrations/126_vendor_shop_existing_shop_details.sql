-- 126_vendor_shop_existing_shop_details.sql
-- Additional Information > Shop Details (Ryan, Sept 2026): when a vendor
-- answers "Yes, I have an existing account on Lizimas Store" they must list
-- their existing shop name(s) and the reason for creating another shop.

BEGIN;

ALTER TABLE vendor_shop_profile
    ADD COLUMN IF NOT EXISTS existing_shop_names TEXT,
    ADD COLUMN IF NOT EXISTS new_shop_reason TEXT;

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '126_vendor_shop_existing_shop_details.sql',
    'vendor_shop_profile: existing_shop_names + new_shop_reason (required when has_existing_shop = true).'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
