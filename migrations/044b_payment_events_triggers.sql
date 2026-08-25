-- 044b_payment_events_triggers.sql
--
-- Replaces the append-only RULES on payment_events with TRIGGERS.
--
-- Why: Postgres refuses INSERT ... ON CONFLICT against any table that has an
-- INSERT or UPDATE rule:
--
--   ERROR: INSERT with ON CONFLICT clause cannot be used with table that has
--          INSERT or UPDATE rules
--
-- recordPaymentOutcome() depends on ON CONFLICT (provider, event_key) DO
-- NOTHING for idempotency - it is what makes a repeated provider callback a
-- no-op instead of a duplicate event. So the rules had to go.
--
-- Triggers enforce the same append-only guarantee and do not interfere with
-- ON CONFLICT. RAISE EXCEPTION rather than the rules' silent DO INSTEAD
-- NOTHING: nothing in the codebase updates or deletes payment_events, so an
-- attempt means a bug, and a bug in an audit trail should be loud.

BEGIN;

DROP RULE IF EXISTS payment_events_no_update ON payment_events;
DROP RULE IF EXISTS payment_events_no_delete ON payment_events;

CREATE OR REPLACE FUNCTION payment_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'payment_events is append-only: % is not permitted', TG_OP
        USING HINT = 'Insert a new event row instead of modifying history.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_events_no_update_trg ON payment_events;
CREATE TRIGGER payment_events_no_update_trg
    BEFORE UPDATE ON payment_events
    FOR EACH ROW EXECUTE FUNCTION payment_events_append_only();

DROP TRIGGER IF EXISTS payment_events_no_delete_trg ON payment_events;
CREATE TRIGGER payment_events_no_delete_trg
    BEFORE DELETE ON payment_events
    FOR EACH ROW EXECUTE FUNCTION payment_events_append_only();

COMMIT;
