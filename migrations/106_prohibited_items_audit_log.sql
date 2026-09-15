-- 106_prohibited_items_audit_log.sql
-- Follow-up to migration 105 - adds the audit trail for prohibited_items
-- changes, matching the pattern used by vendor_kyc_audit_log (079) and
-- vendor_payment_instrument_audit_log (103).
--
-- Unlike those, prohibited_items doesn't have a status column with
-- transitions - it's an admin-managed list where the interesting events
-- are create/update/deactivate. This table records the action, the
-- admin who did it, and the state before/after as JSONB so a rule change
-- ("this keyword used to be active, admin turned it off") is reconstructable
-- without needing a full row-history table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prohibited_items_audit_log (
    id              SERIAL PRIMARY KEY,
    prohibited_item_id INTEGER REFERENCES public.prohibited_items(id) ON DELETE SET NULL,
    action          VARCHAR(20) NOT NULL
                        CHECK (action IN ('created', 'updated', 'deactivated', 'reactivated', 'deleted')),
    changed_by      INTEGER REFERENCES public.users(id),
    before_state    JSONB,
    after_state     JSONB,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prohibited_items_audit_log_item
    ON public.prohibited_items_audit_log (prohibited_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prohibited_items_audit_log_created_at
    ON public.prohibited_items_audit_log (created_at DESC);

COMMENT ON TABLE public.prohibited_items_audit_log IS
    'Audit trail for prohibited_items changes. action is created/updated/deactivated/reactivated/deleted. before_state/after_state are JSONB snapshots of the row (null for created/deleted respectively). prohibited_item_id is nullable so a hard delete still leaves a trace.';

COMMENT ON COLUMN public.prohibited_items_audit_log.before_state IS
    'JSONB snapshot of the row before the change. NULL for action=created.';
COMMENT ON COLUMN public.prohibited_items_audit_log.after_state IS
    'JSONB snapshot of the row after the change. NULL for action=deleted.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '106_prohibited_items_audit_log.sql',
    'Phase 8 follow-up: prohibited_items_audit_log - tracks created/updated/deactivated/reactivated/deleted actions with before/after JSONB snapshots and actor. Matches the audit pattern from vendor_kyc and vendor_payment_instruments.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
