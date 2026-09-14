-- 100_statement_currency_columns.sql
-- Phase 4 Beat 1 - currency columns, unused for now (UGX only).
-- Populated with 'UGX' everywhere so Beat 2 (USD support) can be added
-- later without another schema migration on the money tables.

BEGIN;

ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS preferred_currency VARCHAR(3) NOT NULL DEFAULT 'UGX';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendors_preferred_currency_check'
    ) THEN
        ALTER TABLE vendors
            ADD CONSTRAINT vendors_preferred_currency_check
            CHECK (preferred_currency IN ('UGX', 'USD'));
    END IF;
END $$;

ALTER TABLE vendor_statements
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'UGX',
    ADD COLUMN IF NOT EXISTS fx_rate_used NUMERIC(12,6);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_statements_currency_check'
    ) THEN
        ALTER TABLE vendor_statements
            ADD CONSTRAINT vendor_statements_currency_check
            CHECK (currency IN ('UGX', 'USD'));
    END IF;
END $$;

COMMENT ON COLUMN vendors.preferred_currency IS
    'Vendor''s preferred payout currency. UGX is the only supported value in Beat 1; USD is reserved for Beat 2.';
COMMENT ON COLUMN vendor_statements.currency IS
    'Currency this statement is denominated in. Always UGX in Beat 1.';
COMMENT ON COLUMN vendor_statements.fx_rate_used IS
    'UGX-per-USD exchange rate locked at statement close. NULL for UGX-denominated statements.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '100_statement_currency_columns.sql',
    'Phase 4 Beat 1: preferred_currency on vendors, currency + fx_rate_used on vendor_statements. UGX-only for now.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
