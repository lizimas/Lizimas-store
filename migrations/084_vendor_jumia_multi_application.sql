-- 084_vendor_jumia_multi_application.sql
-- Ryan (Sept 2026), after seeing Jumia's own "Applications" screen again:
-- "a vendor should be able to add several applications, with 2 options on
-- add application as indicated on the screenshot" - Jumia's real Manage
-- Applications page lets a seller create more than one named Application,
-- each either a "Web Application (OAuth - Authorization Code Flow)" or a
-- "Self Authorization (Integration without User interaction)" one (the
-- type this integration has used exclusively so far, and the only one
-- confirmed working end-to-end against a real Jumia account).
--
-- vendor_jumia_connections was one row per vendor (UNIQUE on vendor_id).
-- This migration lifts that to many rows per vendor - one per Application
-- the vendor has added - and adds the fields Jumia's own Create
-- Application dialog collects (name, type, redirect URI for the Web
-- Application flow). Exactly one Application per vendor can be the
-- "active" one actually used for product push/pull/import at a time
-- (is_active, enforced by a partial unique index) - the rest are just
-- managed credentials, same as Jumia's own list is a management view over
-- however many Applications a seller has created.
--
-- Existing rows (every vendor who already connected) become a single
-- 'self_authorization' Application named after their shop, marked active,
-- so nothing already connected changes behaviour.

BEGIN;

ALTER TABLE public.vendor_jumia_connections
    DROP CONSTRAINT IF EXISTS vendor_jumia_connections_vendor_id_key;

ALTER TABLE public.vendor_jumia_connections
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS app_type VARCHAR(20) NOT NULL DEFAULT 'self_authorization'
        CHECK (app_type IN ('self_authorization', 'web_application')),
    ADD COLUMN IF NOT EXISTS redirect_uri TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;

UPDATE public.vendor_jumia_connections
SET name = COALESCE(NULLIF(TRIM(jumia_shop_name), ''), 'Jumia Application'),
    is_active = true
WHERE name IS NULL;

ALTER TABLE public.vendor_jumia_connections
    ALTER COLUMN name SET NOT NULL;

-- At most one active Application per vendor - the one push/pull/import
-- actually use. A partial unique index (rather than a plain UNIQUE on
-- vendor_id) so many inactive/disconnected rows can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_jumia_connections_active
    ON public.vendor_jumia_connections (vendor_id)
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vendor_jumia_connections_vendor
    ON public.vendor_jumia_connections (vendor_id);

COMMENT ON COLUMN public.vendor_jumia_connections.name IS
    'Application Name as the vendor typed it in Create Application - purely a label, never sent to Jumia.';
COMMENT ON COLUMN public.vendor_jumia_connections.app_type IS
    'Which of Jumia''s two Application flows this credential set is: self_authorization (Client ID + Refresh Token, no browser redirect - the only flow confirmed working live) or web_application (OAuth Authorization Code Flow via redirect_uri - see jumiaClient.js header for what is/isn''t verified about this flow).';
COMMENT ON COLUMN public.vendor_jumia_connections.redirect_uri IS
    'Only used by web_application Applications: the callback URL this app registered with Jumia. Always Lizimas''s own fixed OAuth callback route, shown to the vendor to paste into Jumia''s Redirect URI field - not vendor-editable free text.';
COMMENT ON COLUMN public.vendor_jumia_connections.is_active IS
    'Whether this Application is the one product push/pull/import currently use for this vendor. Exactly one true row per vendor at a time (see uq_vendor_jumia_connections_active).';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '084_vendor_jumia_multi_application.sql',
    'Allows multiple named Jumia Applications per vendor (name/app_type/redirect_uri/is_active on vendor_jumia_connections), matching Jumia''s own Applications screen which supports several Web Application or Self Authorization credential sets per seller.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
