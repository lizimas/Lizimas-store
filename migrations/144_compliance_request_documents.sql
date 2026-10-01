-- 144_compliance_request_documents.sql
-- Vendor Compliance redesign (Oct 2026): "Send Required Documents" records a
-- 'request_documents' row in vendor_compliance_actions (the history the
-- admin sees and the Notices feed the vendor sees). The action_type check
-- from migration 069 only lists the original seven actions, so it is
-- replaced with one that also allows 'request_documents'.
-- Every check constraint on action_type is found by its definition (not by
-- name), so this works even if the live constraint was named differently.
-- Any action type already stored is kept, so no existing row can fail.

BEGIN;

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
                                'freeze_payout', 'unfreeze_payout', 'request_documents']) AS t
            UNION
            SELECT DISTINCT action_type FROM public.vendor_compliance_actions WHERE action_type IS NOT NULL
           ) all_types;

    EXECUTE 'ALTER TABLE public.vendor_compliance_actions ADD CONSTRAINT vendor_compliance_actions_action_type_check CHECK (action_type IN (' || allowed || '))';
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('144_compliance_request_documents.sql', 'vendor_compliance_actions.action_type allows request_documents (Send Required Documents).')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
