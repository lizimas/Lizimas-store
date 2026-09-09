-- 062_vendor_storefront_fields.sql
-- Public storefront fields for the vendor page at lizimasstore.com/store/:slug
-- (spec section 17). Additive/nullable: an existing vendor with no logo or
-- banner yet just shows a plain storefront until they upload one.

BEGIN;

ALTER TABLE public.vendors
    ADD COLUMN IF NOT EXISTS slug        VARCHAR(160),
    ADD COLUMN IF NOT EXISTS logo_url    TEXT,
    ADD COLUMN IF NOT EXISTS banner_url  TEXT,
    ADD COLUMN IF NOT EXISTS about       TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_slug
    ON public.vendors (slug)
    WHERE slug IS NOT NULL;

COMMENT ON COLUMN public.vendors.slug IS
    'URL path segment for the public storefront (lizimasstore.com/store/<slug>). Generated from business_name at registration/approval; the backfill below fills it in for any vendor created before this column existed.';

-- Backfill a slug for every vendor that doesn't have one, derived from
-- business_name, with a numeric suffix on collision.
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
    '062_vendor_storefront_fields.sql',
    'vendors.slug/logo_url/banner_url/about for the public storefront page; backfills a unique slug for every existing vendor from business_name.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
