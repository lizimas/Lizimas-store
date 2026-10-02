-- 149_kyc_document_types_check.sql
-- Makes sure vendor_kyc_documents accepts every document type the app
-- uses (Form 20 and Work Permit included). If the type check was ever put
-- back to an older, shorter list, uploading a Form 20 fails with a
-- database error. The check is found by its definition and rebuilt; any
-- type already stored is kept, so no existing row can make this fail.

BEGIN;

DO $$
DECLARE
    c RECORD;
    allowed TEXT;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.vendor_kyc_documents'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%document_type%'
    LOOP
        EXECUTE 'ALTER TABLE public.vendor_kyc_documents DROP CONSTRAINT ' || quote_ident(c.conname);
    END LOOP;

    SELECT string_agg(quote_literal(t), ', ' ORDER BY t) INTO allowed
      FROM (
            SELECT unnest(ARRAY['national_id', 'business_registration', 'bank_certificate', 'tax_certificate',
                                'vat_certificate', 'momo_statement', 'certificate_of_incorporation',
                                'form_20', 'work_permit']) AS t
            UNION
            SELECT DISTINCT document_type FROM public.vendor_kyc_documents WHERE document_type IS NOT NULL
           ) all_types;

    EXECUTE 'ALTER TABLE public.vendor_kyc_documents ADD CONSTRAINT vendor_kyc_documents_document_type_check CHECK (document_type IN (' || allowed || '))';
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('149_kyc_document_types_check.sql', 'vendor_kyc_documents.document_type check allows every type the app uses (form_20, work_permit).')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
