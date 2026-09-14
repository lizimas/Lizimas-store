-- 094_vendor_billing_cycles.sql
-- Phase 4 - Billing Cycles.
-- Defines payment periods for vendors. Bi-weekly: 1st-15th and 16th-end-of-month.
-- The current OPEN cycle is the one earnings accumulate into; admin closes it
-- (manually in 4A, via cron in 4B) to generate statements.
--
-- is_test lets admin generate a cycle in dry-run mode: statements are created
-- but no vendor_payouts rows are generated when marking paid.

BEGIN;

CREATE TABLE IF NOT EXISTS vendor_billing_cycles (
    id SERIAL PRIMARY KEY,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    closes_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed', 'processing', 'statements_generated')),
    statements_generated_at TIMESTAMPTZ,
    statements_generated_by INTEGER REFERENCES users(id),
    is_test BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_vendor_billing_cycles_status ON vendor_billing_cycles (status);
CREATE INDEX IF NOT EXISTS idx_vendor_billing_cycles_period ON vendor_billing_cycles (period_start DESC);

COMMENT ON TABLE vendor_billing_cycles IS
    'Bi-weekly payment periods for vendors. Only one cycle may be OPEN at a time; earnings flow into it. Admin/cron closes it to generate vendor_statements.';
COMMENT ON COLUMN vendor_billing_cycles.is_test IS
    'Dry-run cycle: statements generated normally but mark-paid does not create a real vendor_payouts row.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '094_vendor_billing_cycles.sql',
    'Phase 4: vendor_billing_cycles - bi-weekly payment periods.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
