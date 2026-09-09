-- Adds refund_decision as a 7th vendor_notifications type (Task #70).
--
-- Closes a deliberate scope cut from Task #65: a vendor already sees a
-- refund outcome directly in their Returns & Refunds tab, so this wasn't
-- originally wired up. Adding it anyway so a vendor gets a push the
-- moment Lizimas approves or denies a refund, matching every other
-- decision-type event (compliance_action, payout_update).
--
-- The CHECK constraint on vendor_notifications.type was inline/unnamed at
-- creation (migration 071), so this looks its real name up via
-- pg_constraint rather than guessing the auto-generated name, to avoid
-- silently leaving the old constraint in place alongside a new one.

DO $$
DECLARE
    con_name text;
BEGIN
    SELECT con.conname INTO con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'vendor_notifications'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%type%IN%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE vendor_notifications DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

ALTER TABLE vendor_notifications
    ADD CONSTRAINT vendor_notifications_type_check CHECK (type IN (
        'new_order', 'low_stock', 'product_approved', 'product_rejected',
        'compliance_action', 'payout_update', 'refund_decision'
    ));

INSERT INTO schema_migrations (filename, note)
VALUES (
    '074_vendor_notif_refund_decision.sql',
    'vendor_notifications.type gains refund_decision - a vendor now gets a bell notification when Lizimas approves or denies their return refund, not just a tab to check.'
)
ON CONFLICT (filename) DO NOTHING;
