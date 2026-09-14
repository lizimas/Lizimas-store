-- 097_payouts_statement_link.sql
-- Phase 4 - link vendor_payouts rows back to the statement they were
-- generated for. Adds statement_id so we can always answer "which cycle
-- paid for this?".

BEGIN;

ALTER TABLE vendor_payouts
    ADD COLUMN IF NOT EXISTS statement_id INTEGER REFERENCES vendor_statements(id);

CREATE INDEX IF NOT EXISTS idx_vendor_payouts_statement ON vendor_payouts (statement_id) WHERE statement_id IS NOT NULL;

COMMENT ON COLUMN vendor_payouts.statement_id IS
    'Which vendor_statement this payout came from. NULL for legacy on-demand payouts.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '097_payouts_statement_link.sql',
    'Phase 4: vendor_payouts.statement_id linking payouts to billing cycle statements.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
