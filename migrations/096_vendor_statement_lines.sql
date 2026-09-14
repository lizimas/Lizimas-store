-- 096_vendor_statement_lines.sql
-- Phase 4 - itemized breakdown for each statement. Every line has a
-- reference_id pointing at the source row (order_item, ledger adjustment, etc)
-- so any number on a statement can be traced back to its origin.

BEGIN;

CREATE TABLE IF NOT EXISTS vendor_statement_lines (
    id SERIAL PRIMARY KEY,
    statement_id INTEGER NOT NULL REFERENCES vendor_statements(id) ON DELETE CASCADE,
    line_type VARCHAR(30) NOT NULL
        CHECK (line_type IN ('opening_balance', 'order_earning', 'commission',
                             'refund', 'adjustment', 'minimum_rollover', 'closing_balance')),
    reference_id INTEGER,
    description TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_statement_lines_statement ON vendor_statement_lines (statement_id);

COMMENT ON TABLE vendor_statement_lines IS
    'Itemized entries backing each vendor_statement. Sum of all lines equals amount_due. Each line traces to its source row via reference_id.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '096_vendor_statement_lines.sql',
    'Phase 4: vendor_statement_lines - itemized audit trail per statement.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
