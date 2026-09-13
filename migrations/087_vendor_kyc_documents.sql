-- 087_vendor_kyc_documents.sql
-- KYC Stage 2: lets a vendor upload the identity/business document that
-- backs their vendor_kyc submission (migration 079), and lets admin view
-- it during review.
--
-- Documents are stored privately in Cloudinary (type: "private" - see
-- server/utils/cloudinaryUpload.js's uploadPrivateDocument), never
-- publicly reachable like every other upload in this codebase so far.
-- Only the Cloudinary public_id/resource_type/format needed to mint a
-- short-lived signed view URL is stored here - no file content, no
-- personal-data fields beyond the filename the vendor themselves chose.
--
-- One row per (vendor_id, document_type): a re-upload REPLACES the prior
-- document (the controller destroys the old Cloudinary asset) rather than
-- versioning it, matching vendor_kyc's own "current state, separate audit
-- log for status transitions only" shape.

BEGIN;

CREATE TABLE IF NOT EXISTS vendor_kyc_documents (
    id BIGSERIAL PRIMARY KEY,
    vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL CHECK (document_type IN ('national_id', 'business_registration')),
    cloudinary_public_id TEXT NOT NULL,
    resource_type TEXT NOT NULL DEFAULT 'image',
    format TEXT,
    original_filename TEXT,
    bytes INTEGER,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vendor_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_vendor_kyc_documents_vendor_id ON vendor_kyc_documents(vendor_id);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '087_vendor_kyc_documents.sql',
    'Adds vendor_kyc_documents so vendors can upload (and admin can privately view) the ID/business-registration document backing a KYC submission.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
