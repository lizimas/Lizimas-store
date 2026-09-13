-- 091_vendor_kyc_ursb.sql
-- URSB verification tracking for company vendors. The admin manually
-- looks up the vendor's registration number on eregistry.ursb.go.ug and
-- records the result here. Required for kyc_status='verified' when
-- vendors.account_type='company' (see reviewVendorKycAdmin controller).

BEGIN;

ALTER TABLE vendor_kyc
    ADD COLUMN IF NOT EXISTS ursb_verified BOOLEAN,
    ADD COLUMN IF NOT EXISTS ursb_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ursb_verified_by INTEGER REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS ursb_evidence_url TEXT;

COMMENT ON COLUMN vendor_kyc.ursb_verified IS
    'TRUE if admin confirmed the vendor''s registration_number exists in URSB''s eRegistry. NULL = not checked. Required to be TRUE before a company vendor can be marked kyc_status=verified.';
COMMENT ON COLUMN vendor_kyc.ursb_evidence_url IS
    'Optional URL to the URSB search result (PRN receipt, PDF, or screenshot), for audit purposes.';

CREATE INDEX IF NOT EXISTS idx_vendor_kyc_ursb_verified
    ON vendor_kyc (ursb_verified)
    WHERE ursb_verified IS NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '091_vendor_kyc_ursb.sql',
    'Adds ursb_verified/ursb_verified_at/ursb_verified_by/ursb_evidence_url to vendor_kyc for manual URSB verification of company vendors.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
