-- 088_vendor_kyc_review_enhancements.sql
-- Closes 3 gaps vs Jumia's KYC flow:
--   1. Vendors get a notification when kyc_status changes.
--   2. Each KYC document gets its own review status + rejection reason.
--   3. Expands document_type to Jumia-parity set.

BEGIN;

DO $$
DECLARE con_name text;
BEGIN
    SELECT con.conname INTO con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
    WHERE rel.relname = 'vendor_notifications' AND con.contype = 'c'
      AND att.attname = 'type' AND array_length(con.conkey, 1) = 1;
    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE vendor_notifications DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

ALTER TABLE vendor_notifications
    ADD CONSTRAINT vendor_notifications_type_check CHECK (type IN (
        'new_order', 'low_stock', 'product_approved', 'product_rejected',
        'compliance_action', 'payout_update', 'refund_decision',
        'kyc_status_change'
    ));

ALTER TABLE vendor_kyc_documents
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'accepted', 'rejected', 'action_required')),
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

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
        'certificate_of_incorporation'
    ));

INSERT INTO schema_migrations (filename, note)
VALUES ('088_vendor_kyc_review_enhancements.sql',
        'Adds kyc_status_change notification, per-document review_status/rejection_reason, expands document_type to Jumia-parity set.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
