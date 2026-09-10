-- 077_vendor_messages_escalation.sql
-- Vendor messages route to customer_support by default now (Task #76,
-- Ryan Sept 2026: "vendors to communicate with support team not admin
-- directly, unless required then the support team will redial them to
-- admin"). This adds the flag support uses to hand a thread to admin -
-- escalated_at, set/cleared by a support agent (or admin) from the
-- thread view. Not a routing change in the DB itself: every thread still
-- lives in one vendor_messages table, readable by both roles
-- (requireSupportOrAdmin) - escalation just flags which ones need admin's
-- eyes, surfaced as a third filter view alongside Open/Resolved.

BEGIN;

ALTER TABLE public.vendor_messages
    ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.vendor_messages.escalated_at IS
    'Set when a support agent (or admin) flags this thread for admin attention. NULL means it has not been escalated (or was un-escalated). Does not affect who can see/reply to the thread - admin and customer_support already share the same inbox.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '077_vendor_messages_escalation.sql',
    'Adds vendor_messages.escalated_at so support staff can flag a thread for admin attention, surfaced as an Escalated filter view alongside Open/Resolved.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
