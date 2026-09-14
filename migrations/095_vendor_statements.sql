-- 095_vendor_statements.sql
-- Phase 4 - one row per vendor per cycle. Records the numbers (opening,
-- earnings, deductions, amount due) that make up what the vendor is owed
-- for that cycle, plus the approval/payment state of that payout.
--
-- status meanings:
--   pending        - generated, awaiting admin approval
--   approved       - admin approved, ready to pay
--   paid           - payout completed (links to vendor_payouts)
--   rejected       - admin declined this statement
--   failed         - payout attempt failed, needs admin intervention
--   rolled_forward - amount < MIN_PAYOUT; carried into next cycle as opening

BEGIN;

CREATE TABLE IF NOT EXISTS vendor_statements (
    id SERIAL PRIMARY KEY,
    cycle_id INTEGER NOT NULL REFERENCES vendor_billing_cycles(id),
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
    commissions NUMERIC(12,2) NOT NULL DEFAULT 0,
    refund_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
    adjustments NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_due NUMERIC(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'failed', 'rolled_forward')),
    payout_id INTEGER REFERENCES vendor_payouts(id),
    approved_at TIMESTAMPTZ,
    approved_by INTEGER REFERENCES users(id),
    paid_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cycle_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_statements_vendor ON vendor_statements (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_statements_cycle ON vendor_statements (cycle_id);
CREATE INDEX IF NOT EXISTS idx_vendor_statements_status ON vendor_statements (status);

COMMENT ON TABLE vendor_statements IS
    'Per-vendor per-cycle statement of amounts owed. Generated when admin closes a cycle. row.status drives the payment workflow.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '095_vendor_statements.sql',
    'Phase 4: vendor_statements - per-vendor per-cycle amounts owed.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
