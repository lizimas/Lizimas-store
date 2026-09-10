-- 079_vendor_kyc.sql
-- Vendor KYC & Compliance Profile (Ryan, Sept 2026 - "give every vendor
-- a KYC status", modelled on Jumia's KYC/verification approach). Splits
-- identity/business-registration data out of the vendors table into its
-- own restricted table, encrypted at rest, with an explicit review
-- workflow and audit trail - separate from vendors.status, which only
-- ever meant "allowed to sell," not "identity verified."
--
-- vendors.national_id_number/registration_number are left in place for
-- now (legacy/frozen - the app stops reading and writing them as of this
-- change) rather than dropped, so nothing is lost if a rollback is ever
-- needed. A follow-up migration can drop them once
-- scripts/backfill-vendor-kyc.js has moved everything across and Ryan's
-- confirmed the cutover is solid.
--
-- Encryption is application-level (server/utils/encryption.js, AES-256-
-- GCM), not pgcrypto, so it works the same locally and on Render without
-- a Postgres extension dependency. Because AES-GCM uses a random IV, the
-- same ID number encrypts differently every time - so a deterministic
-- HMAC-SHA256 "blind index" hash is stored alongside each encrypted
-- value purely so admin can still look up/dedupe by ID number without
-- ever decrypting anything for that purpose. That hash is what migration
-- 054's old plaintext dedup indexes are replaced with here, scoped to
-- kyc_status = 'verified' (the new, more meaningful equivalent of
-- "approved" for identity purposes).

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_kyc (
    id                          SERIAL PRIMARY KEY,
    vendor_id                   INTEGER NOT NULL UNIQUE REFERENCES public.vendors(id),
    kyc_status                  VARCHAR(20) NOT NULL DEFAULT 'not_started'
                                    CHECK (kyc_status IN (
                                        'not_started', 'submitted', 'under_review',
                                        'action_required', 'verified', 'rejected', 'suspended'
                                    )),
    identity_verified           BOOLEAN NOT NULL DEFAULT false,
    business_verified           BOOLEAN NOT NULL DEFAULT false,
    national_id_number_enc      TEXT,
    national_id_number_hash     TEXT,
    registration_number_enc     TEXT,
    registration_number_hash    TEXT,
    review_note                 TEXT,
    reviewed_by                 INTEGER REFERENCES public.users(id),
    reviewed_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_kyc_status ON public.vendor_kyc (kyc_status);

-- One verified identity/business number per business - the encrypted
-- equivalent of migration 054's plaintext dedup, scoped to 'verified'
-- (today's real trust boundary) rather than the old 'approved' (which
-- only ever meant "allowed to sell", nothing about verified identity).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_kyc_natid_hash_verified
    ON public.vendor_kyc (national_id_number_hash)
    WHERE kyc_status = 'verified' AND national_id_number_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_kyc_regnum_hash_verified
    ON public.vendor_kyc (registration_number_hash)
    WHERE kyc_status = 'verified' AND registration_number_hash IS NOT NULL;

COMMENT ON TABLE public.vendor_kyc IS
    'Restricted vendor identity/business-verification profile - admin-only, separate from the vendors table shown to the vendor themselves and never exposed publicly. national_id_number/registration_number are encrypted at rest (AES-256-GCM, server/utils/encryption.js) with a deterministic hash alongside each for dedup lookups without decryption.';

CREATE TABLE IF NOT EXISTS public.vendor_kyc_audit_log (
    id            SERIAL PRIMARY KEY,
    vendor_id     INTEGER NOT NULL REFERENCES public.vendors(id),
    from_status   VARCHAR(20),
    to_status     VARCHAR(20) NOT NULL,
    changed_by    INTEGER REFERENCES public.users(id),
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_kyc_audit_log_vendor ON public.vendor_kyc_audit_log (vendor_id, created_at DESC);

COMMENT ON TABLE public.vendor_kyc_audit_log IS
    'Who changed a vendor''s KYC status, from what to what, and when. changed_by NULL means the vendor made the change themselves (e.g. submitting/resubmitting their info) rather than an admin review action.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '079_vendor_kyc.sql',
    'Adds vendor_kyc (encrypted identity/business-registration data, kyc_status workflow, admin-only) and vendor_kyc_audit_log. vendors.national_id_number/registration_number are now legacy/frozen columns - see scripts/backfill-vendor-kyc.js.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
