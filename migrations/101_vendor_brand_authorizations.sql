-- 101_vendor_brand_authorizations.sql
-- Phase 7 - Brand Authorization (Ryan, Sept 2026 - modelled on Jumia's
-- brand authorization tiers). A vendor requests authorization for ONE
-- brand at a time, at one of two tiers:
--   official_store         - presented AS the brand ("Samsung Official
--                             Store"). Full documentary bar.
--   authorized_distributor - authorized to distribute the brand but not
--                             presented as it ("XYZ Electronics -
--                             Authorized Samsung Distributor"). Lighter
--                             bar. See server/utils/vendorBrandAuth.js
--                             for the exact per-tier document
--                             requirements and the review workflow.
--
-- Same seven-state review workflow as vendor_kyc (migration 079), kept as
-- its own independent table/state machine on purpose - a compliance
-- reviewer working the brand-authorization queue must never accidentally
-- touch identity/KYC status, and vice versa.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_brand_authorizations (
    id              SERIAL PRIMARY KEY,
    vendor_id       INTEGER NOT NULL REFERENCES public.vendors(id),
    brand_name      VARCHAR(100) NOT NULL,
    tier            VARCHAR(30) NOT NULL
                        CHECK (tier IN ('official_store', 'authorized_distributor')),
    status          VARCHAR(20) NOT NULL DEFAULT 'not_started'
                        CHECK (status IN (
                            'not_started', 'submitted', 'under_review',
                            'action_required', 'verified', 'rejected', 'suspended'
                        )),
    review_note     TEXT,
    reviewed_by     INTEGER REFERENCES public.users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vendor_id, brand_name)
);

CREATE INDEX IF NOT EXISTS idx_vendor_brand_auth_vendor ON public.vendor_brand_authorizations (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_brand_auth_status ON public.vendor_brand_authorizations (status);
-- Case-insensitive brand lookup for the storefront badge join and for admin
-- search ("Samsung" vs "samsung" should be the same authorization record).
CREATE INDEX IF NOT EXISTS idx_vendor_brand_auth_brand_lower ON public.vendor_brand_authorizations (lower(brand_name));

COMMENT ON TABLE public.vendor_brand_authorizations IS
    'One row per (vendor, brand) a vendor has requested authorization to sell under. tier is official_store or authorized_distributor - see server/utils/vendorBrandAuth.js for per-tier document requirements. status reuses vendor_kyc''s seven-state workflow shape as an independent state machine.';

CREATE TABLE IF NOT EXISTS public.vendor_brand_authorization_audit_log (
    id                      SERIAL PRIMARY KEY,
    brand_authorization_id  INTEGER NOT NULL REFERENCES public.vendor_brand_authorizations(id) ON DELETE CASCADE,
    from_status             VARCHAR(20),
    to_status               VARCHAR(20) NOT NULL,
    changed_by              INTEGER REFERENCES public.users(id),
    note                    TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_brand_auth_audit_log_auth
    ON public.vendor_brand_authorization_audit_log (brand_authorization_id, created_at DESC);

COMMENT ON TABLE public.vendor_brand_authorization_audit_log IS
    'Who changed a vendor brand authorization''s status, from what to what, and when. changed_by NULL means the vendor made the change themselves (e.g. submitting/resubmitting).';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '101_vendor_brand_authorizations.sql',
    'Phase 7: vendor_brand_authorizations (per-vendor per-brand tier + status workflow) and vendor_brand_authorization_audit_log.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
