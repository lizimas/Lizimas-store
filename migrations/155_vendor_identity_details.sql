-- Identity details read from the vendor's ID (Oct 2026). The vendor uploads
-- the front and then the back of the card; the details printed on it are read
-- into the form, corrected by the vendor if needed, and kept here for the
-- reviewer. The NIN and the card number are stored encrypted, like the other
-- identity numbers in vendor_kyc.
CREATE TABLE IF NOT EXISTS vendor_identity_details (
    vendor_id        BIGINT PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
    id_kind          VARCHAR(20),
    -- front of the card
    surname          VARCHAR(80),
    given_names      VARCHAR(120),
    nationality      VARCHAR(40),
    sex              CHAR(1) CHECK (sex IS NULL OR sex IN ('M', 'F')),
    date_of_birth    DATE,
    nin_enc          TEXT,
    card_number_enc  TEXT,
    expires_on       DATE,
    -- back of the card
    village          VARCHAR(80),
    parish           VARCHAR(80),
    sub_county       VARCHAR(80),
    county           VARCHAR(80),
    district         VARCHAR(80),
    -- which boxes the vendor changed after the card was read (for the reviewer)
    edited_fields    JSONB,
    front_read       BOOLEAN NOT NULL DEFAULT false,
    back_read        BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The back of the ID is its own file, next to the front (national_id).
-- The type check is found by its definition and rebuilt (as migration 149
-- does); any type already stored is kept, so no existing row can make this fail.
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
            SELECT unnest(ARRAY['national_id', 'national_id_back', 'business_registration', 'bank_certificate', 'tax_certificate',
                                'vat_certificate', 'momo_statement', 'certificate_of_incorporation',
                                'form_20', 'work_permit']) AS t
            UNION
            SELECT DISTINCT document_type FROM public.vendor_kyc_documents WHERE document_type IS NOT NULL
           ) x;

    EXECUTE 'ALTER TABLE public.vendor_kyc_documents ADD CONSTRAINT vendor_kyc_documents_document_type_check CHECK (document_type IN (' || allowed || '))';
END $$;
