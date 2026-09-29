-- 140_kyc_identity_document_checks.sql
-- Identity document checks (Ryan, Sept 2026). The identity slot
-- (document_type 'national_id') now takes a National ID, Passport or
-- Driving Licence. The vendor states which one, its number and expiry
-- date (must be in the future); the automatic photo checks' results are
-- kept for the admin reviewer, who confirms type, authenticity and details
-- against the photo before accepting it.

BEGIN;

ALTER TABLE public.vendor_kyc_documents
    ADD COLUMN IF NOT EXISTS id_kind VARCHAR(20)
        CHECK (id_kind IS NULL OR id_kind IN ('national_id', 'passport', 'driving_license')),
    ADD COLUMN IF NOT EXISTS id_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS id_expires_on DATE,
    ADD COLUMN IF NOT EXISTS auto_checks JSONB,
    ADD COLUMN IF NOT EXISTS review_checks_confirmed BOOLEAN NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('140_kyc_identity_document_checks.sql', 'vendor_kyc_documents: id_kind, id_number, id_expires_on, auto_checks, review_checks_confirmed.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
