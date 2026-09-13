-- 093_per_document_action_reason.sql
-- Per-document "action required" needs its own reason field, distinct from
-- "rejected". A doc that's merely blurry is action_required (fixable); a
-- doc that's clearly fake is rejected (not fixable). Both need a reason
-- shown to the vendor.

BEGIN;

ALTER TABLE vendor_kyc_documents
    ADD COLUMN IF NOT EXISTS action_required_reason TEXT;

COMMENT ON COLUMN vendor_kyc_documents.action_required_reason IS
    'Free-text explanation shown to the vendor when review_status = action_required (e.g. "Photo is blurry, please re-upload").';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '093_per_document_action_reason.sql',
    'Adds action_required_reason to vendor_kyc_documents for the per-document review flow.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
