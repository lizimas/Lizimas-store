-- 148_kyc_document_versions.sql
-- Document version history (Oct 2026): when a vendor uploads a document
-- again, the one it replaces is kept here (with how it was reviewed)
-- instead of being thrown away, so admin can look back at what was sent
-- before. The newest five per vendor and document type are kept.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_kyc_document_versions (
    id                   BIGSERIAL PRIMARY KEY,
    vendor_id            BIGINT NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    document_type        TEXT NOT NULL,
    cloudinary_public_id TEXT NOT NULL,
    resource_type        TEXT NOT NULL DEFAULT 'image',
    format               TEXT,
    original_filename    TEXT,
    bytes                INTEGER,
    uploaded_at          TIMESTAMPTZ,
    review_status        VARCHAR(20),
    review_reason        TEXT,
    reviewed_at          TIMESTAMPTZ,
    replaced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_doc_versions_vendor_type
    ON public.vendor_kyc_document_versions (vendor_id, document_type, replaced_at DESC);

INSERT INTO public.schema_migrations (filename, note)
VALUES ('148_kyc_document_versions.sql', 'vendor_kyc_document_versions: earlier uploads of a vendor document, kept for admin.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
