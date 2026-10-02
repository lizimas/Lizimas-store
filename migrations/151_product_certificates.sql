-- 151_product_certificates.sql
-- A certification only shows on a product once the vendor has uploaded the
-- certificate and Lizimas Store has approved it (Ryan, Oct 2026).
-- products.certifications now holds only the approved ones; certifications
-- ticked before this (without proof) are cleared.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_certificates (
    id                   BIGSERIAL PRIMARY KEY,
    product_id           INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    vendor_id            INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    certification        TEXT NOT NULL,
    cloudinary_public_id TEXT NOT NULL,
    resource_type        TEXT NOT NULL DEFAULT 'image',
    format               TEXT,
    original_filename    TEXT,
    status               VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason     TEXT,
    uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by          INTEGER REFERENCES public.users(id),
    reviewed_at          TIMESTAMPTZ,
    UNIQUE (product_id, certification)
);

CREATE INDEX IF NOT EXISTS idx_product_certificates_status ON public.product_certificates (status);
CREATE INDEX IF NOT EXISTS idx_product_certificates_vendor ON public.product_certificates (vendor_id);

UPDATE public.products SET certifications = '{}' WHERE certifications <> '{}';

INSERT INTO public.schema_migrations (filename, note)
VALUES ('151_product_certificates.sql', 'product_certificates: a certification needs an uploaded certificate approved by admin before it shows.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
