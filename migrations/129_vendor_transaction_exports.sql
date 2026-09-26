-- 129_vendor_transaction_exports.sql
-- Account Statements > Transactions Exports (Ryan, Sept 2026 - Channel
-- parity). One row each time a vendor exports transactions: a single
-- statement (PDF or CSV) or all statements at once (CSV). Files are still
-- generated on demand from the statement data, so "Download" on a row just
-- rebuilds the same export.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_transaction_exports (
    id            SERIAL PRIMARY KEY,
    vendor_id     INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    kind          VARCHAR(30) NOT NULL CHECK (kind IN ('statement_pdf', 'statement_csv', 'all_transactions')),
    statement_id  INTEGER REFERENCES public.vendor_statements(id) ON DELETE SET NULL,
    requested     TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'failed')),
    created_by    INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_transaction_exports_vendor
    ON public.vendor_transaction_exports (vendor_id, created_at DESC);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '129_vendor_transaction_exports.sql',
    'vendor_transaction_exports: log of statement / all-transaction exports shown under Account Statements.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
