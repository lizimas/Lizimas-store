-- 083_backfill_vendor_slugs.sql
-- Fixes a gap left by migration 062: it backfilled a storefront slug for
-- every vendor that existed *at the time it ran*, but approveVendor()
-- (server/controllers/vendorController.js) never generated one for a
-- vendor approved since then - so any such vendor's products silently
-- never showed a "Sold by" panel on the storefront (client/js/
-- product-detail.js's loadSellerPanel only fires when product.vendor_slug
-- is truthy), even though the vendor was fully approved. Caught via a
-- real vendor ("Talent Gadgets") whose product had no seller info on the
-- live storefront despite being an approved vendor. approveVendor() now
-- generates a slug at approval time going forward; this is the one-time
-- catch-up for every vendor still missing one right now.

BEGIN;

DO $$
DECLARE
    v RECORD;
    base_slug TEXT;
    candidate TEXT;
    suffix INT;
BEGIN
    FOR v IN SELECT id, business_name FROM public.vendors WHERE slug IS NULL ORDER BY id LOOP
        base_slug := lower(regexp_replace(trim(v.business_name), '[^a-zA-Z0-9]+', '-', 'g'));
        base_slug := trim(both '-' from base_slug);
        IF base_slug = '' THEN
            base_slug := 'vendor-' || v.id;
        END IF;

        candidate := base_slug;
        suffix := 1;
        WHILE EXISTS (SELECT 1 FROM public.vendors WHERE slug = candidate AND id <> v.id) LOOP
            suffix := suffix + 1;
            candidate := base_slug || '-' || suffix;
        END LOOP;

        UPDATE public.vendors SET slug = candidate WHERE id = v.id;
    END LOOP;
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '083_backfill_vendor_slugs.sql',
    'Backfills vendors.slug for any vendor approved after migration 062 ran (approveVendor() did not generate one) - fixes missing "Sold by" panels on the storefront, e.g. Talent Gadgets.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
