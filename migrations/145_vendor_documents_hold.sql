-- 145_vendor_documents_hold.sql
-- "Hold for documents" (Oct 2026, Ryan): admin can put an existing vendor
-- on hold until they upload documents. While on hold their products are
-- hidden from the store, their shop page shows as unavailable, they can't
-- add or edit products and payouts are blocked - but they can still sign
-- in and upload. The hold lifts automatically once every held document is
-- approved (server/utils/vendorHold.js).
--   vendors.documents_hold         - on hold right now
--   vendors.hold_documents         - document types they must provide
--   vendors.hold_reason            - admin's message (shown to the vendor)
--   vendors.hold_started_at / hold_by
-- vendor_compliance_actions.action_type also gains 'hold_documents' and
-- 'release_hold' (same safe rebuild of the check as migration 144).

BEGIN;

ALTER TABLE public.vendors
    ADD COLUMN IF NOT EXISTS documents_hold BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS hold_documents TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS hold_reason TEXT,
    ADD COLUMN IF NOT EXISTS hold_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hold_by INTEGER REFERENCES public.users(id);

COMMENT ON COLUMN public.vendors.documents_hold IS 'Admin hold until documents are provided: products hidden, shop unavailable, no product edits, no payouts. Lifted automatically when every hold_documents type is accepted.';

DO $$
DECLARE
    c RECORD;
    allowed TEXT;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'public.vendor_compliance_actions'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%action_type%'
    LOOP
        EXECUTE 'ALTER TABLE public.vendor_compliance_actions DROP CONSTRAINT ' || quote_ident(c.conname);
    END LOOP;

    SELECT string_agg(quote_literal(t), ', ' ORDER BY t) INTO allowed
      FROM (
            SELECT unnest(ARRAY['warn', 'suspend', 'reinstate', 'restrict_product', 'unrestrict_product',
                                'freeze_payout', 'unfreeze_payout', 'request_documents',
                                'hold_documents', 'release_hold']) AS t
            UNION
            SELECT DISTINCT action_type FROM public.vendor_compliance_actions WHERE action_type IS NOT NULL
           ) all_types;

    EXECUTE 'ALTER TABLE public.vendor_compliance_actions ADD CONSTRAINT vendor_compliance_actions_action_type_check CHECK (action_type IN (' || allowed || '))';
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('145_vendor_documents_hold.sql', 'Hold for documents: vendors.documents_hold/hold_documents/hold_reason/hold_started_at/hold_by; compliance actions hold_documents and release_hold.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
