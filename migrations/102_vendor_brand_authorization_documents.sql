-- 102_vendor_brand_authorization_documents.sql
-- Phase 7 - documents backing a vendor_brand_authorizations request.
-- Mirrors vendor_kyc_documents (migration 087) but with the per-document
-- review fields (review_status/rejection_reason/action_required_reason/
-- reviewed_by/reviewed_at) baked in from the start, rather than needing a
-- follow-up migration the way vendor_kyc_documents did (see migration
-- 088) - learned from that history.
--
-- Documents are stored privately in Cloudinary (type: "private" - see
-- server/utils/cloudinaryUpload.js's uploadPrivateDocument), same as
-- every KYC document, never publicly reachable. One row per (vendor_id,
-- brand_authorization_id, document_type): a re-upload REPLACES the prior
-- document rather than versioning it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_brand_authorization_documents (
    id                          BIGSERIAL PRIMARY KEY,
    brand_authorization_id      INTEGER NOT NULL REFERENCES public.vendor_brand_authorizations(id) ON DELETE CASCADE,
    vendor_id                   INTEGER NOT NULL REFERENCES public.vendors(id),
    document_type               TEXT NOT NULL CHECK (document_type IN (
                                    'authorization_letter',
                                    'distributor_agreement',
                                    'manufacturer_authorization',
                                    'business_registration',
                                    'tax_documentation',
                                    'relationship_proof',
                                    'warranty_information',
                                    'sourcing_proof'
                                 )),
    cloudinary_public_id        TEXT NOT NULL,
    resource_type                TEXT NOT NULL DEFAULT 'image',
    format                       TEXT,
    original_filename            TEXT,
    bytes                        INTEGER,
    review_status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                                     CHECK (review_status IN ('pending', 'accepted', 'rejected', 'action_required')),
    rejection_reason              TEXT,
    action_required_reason        TEXT,
    reviewed_by                   INTEGER REFERENCES public.users(id),
    reviewed_at                   TIMESTAMPTZ,
    uploaded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (brand_authorization_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_vendor_brand_auth_documents_auth
    ON public.vendor_brand_authorization_documents (brand_authorization_id);
CREATE INDEX IF NOT EXISTS idx_vendor_brand_auth_documents_vendor
    ON public.vendor_brand_authorization_documents (vendor_id);

COMMENT ON TABLE public.vendor_brand_authorization_documents IS
    'Documents backing one vendor_brand_authorizations request - private Cloudinary storage, per-document review status. See migrations/087_vendor_kyc_documents.sql for the equivalent KYC-document shape this mirrors.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '102_vendor_brand_authorization_documents.sql',
    'Phase 7: vendor_brand_authorization_documents - private Cloudinary-backed documents per brand authorization request, with per-document review fields included from the start.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
