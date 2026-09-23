-- 122_vendor_kyc_jumia_parity.sql
-- Closes the remaining gaps vs Jumia's Uganda vendor KYC requirements
-- (Ryan, Sept 2026 - decisions: VAT required for all company vendors;
-- payment instruments get a supporting evidence document; build all of
-- TIN/VAT/Form 20/work permit in one pass).
--
-- Migration 088 already widened vendor_kyc_documents.document_type to a
-- "Jumia-parity set" (tax_certificate, vat_certificate, bank_certificate,
-- momo_statement, certificate_of_incorporation) but the app layer never
-- used most of them, and two document types Jumia requires were never
-- added at all (Form 20, work permit). This migration:
--   1. Adds encrypted TIN/VAT number fields to vendor_kyc, same
--      AES-256-GCM + blind-index-hash pattern as national_id/registration_number.
--   2. Adds a requires_work_permit flag - Jumia only asks for this from
--      non-Ugandan vendors, and there's currently no field anywhere that
--      distinguishes them.
--   3. Adds 'form_20' and 'work_permit' to document_type.
--   4. Adds evidence-document columns to vendor_payment_instruments
--      itself, NOT vendor_kyc_documents - a vendor can hold several
--      instruments (a MoMo account AND a bank account), each needing its
--      own specific proof, so a single shared per-vendor slot in
--      vendor_kyc_documents (UNIQUE on vendor_id, document_type) would be
--      wrong here. Mirrors vendor_kyc_documents' private-Cloudinary shape
--      exactly, just scoped to the one instrument it backs.

BEGIN;

-- 1 & 2: vendor_kyc additions --------------------------------------------

ALTER TABLE vendor_kyc
    ADD COLUMN IF NOT EXISTS tin_number_enc TEXT,
    ADD COLUMN IF NOT EXISTS tin_number_hash TEXT,
    ADD COLUMN IF NOT EXISTS vat_number_enc TEXT,
    ADD COLUMN IF NOT EXISTS vat_number_hash TEXT,
    ADD COLUMN IF NOT EXISTS requires_work_permit BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN vendor_kyc.requires_work_permit IS
    'Self-declared by the vendor at KYC submission: true if they are not Ugandan and therefore need a work_permit document. Only meaningful in combination with account_type (individual vendors declare this about themselves; company vendors would declare it about their legal representative).';

-- Same verified-only dedup pattern as national_id_number/registration_number
-- (migration 079) - a TIN or VAT number should belong to one verified
-- business, not several.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_kyc_tin_hash_verified
    ON vendor_kyc (tin_number_hash)
    WHERE kyc_status = 'verified' AND tin_number_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_kyc_vat_hash_verified
    ON vendor_kyc (vat_number_hash)
    WHERE kyc_status = 'verified' AND vat_number_hash IS NOT NULL;

-- 3: widen document_type --------------------------------------------------

ALTER TABLE vendor_kyc_documents
    DROP CONSTRAINT IF EXISTS vendor_kyc_documents_document_type_check;

ALTER TABLE vendor_kyc_documents
    ADD CONSTRAINT vendor_kyc_documents_document_type_check
    CHECK (document_type IN (
        'national_id',
        'business_registration',
        'bank_certificate',
        'tax_certificate',
        'vat_certificate',
        'momo_statement',
        'certificate_of_incorporation',
        'form_20',
        'work_permit'
    ));

-- 4: payment instrument evidence ------------------------------------------

ALTER TABLE vendor_payment_instruments
    ADD COLUMN IF NOT EXISTS evidence_cloudinary_public_id TEXT,
    ADD COLUMN IF NOT EXISTS evidence_resource_type TEXT,
    ADD COLUMN IF NOT EXISTS evidence_format TEXT,
    ADD COLUMN IF NOT EXISTS evidence_original_filename TEXT,
    ADD COLUMN IF NOT EXISTS evidence_bytes INTEGER,
    ADD COLUMN IF NOT EXISTS evidence_uploaded_at TIMESTAMPTZ;

COMMENT ON COLUMN vendor_payment_instruments.evidence_cloudinary_public_id IS
    'Private Cloudinary document (bank certificate or MoMo statement) backing this specific instrument. Same private-storage pattern as vendor_kyc_documents (server/utils/cloudinaryUpload.js), scoped per-instrument rather than per-vendor since a vendor can hold several instruments at once.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '122_vendor_kyc_jumia_parity.sql',
    'Adds TIN/VAT encrypted fields + requires_work_permit to vendor_kyc; adds form_20/work_permit to vendor_kyc_documents.document_type; adds evidence document columns to vendor_payment_instruments.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
