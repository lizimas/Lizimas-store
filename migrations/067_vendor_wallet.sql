BEGIN;

-- Vendor Wallet & Payouts (Task #61).
--
-- The wallet BALANCE itself is not stored anywhere - it is derived on each
-- read from order_items + products' commission fields (server/utils/
-- vendorWallet.js), the same approximation getVendorDashboardSummary
-- already uses. Only the two things that genuinely cannot be derived from
-- anything else get real tables here: money actually paid out to a vendor,
-- and one-off manual adjustments an admin makes to a vendor's balance.

CREATE TABLE IF NOT EXISTS vendor_payouts (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method VARCHAR(20) NOT NULL DEFAULT 'momo',
    momo_number VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'rejected')),
    reference VARCHAR(120),
    notes TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    paid_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_payouts_vendor ON vendor_payouts (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payouts_status ON vendor_payouts (status);

COMMENT ON TABLE vendor_payouts IS 'Money actually requested/paid out to a vendor. The wallet balance itself is derived, not stored - see server/utils/vendorWallet.js.';
COMMENT ON COLUMN vendor_payouts.method IS 'Payout channel. MoMo-only for now (vendors.momo_number is the only payout detail Lizimas collects) - a default, tunable if another channel is added later.';
COMMENT ON COLUMN vendor_payouts.momo_number IS 'Snapshot of vendors.momo_number at request time, so a later change to the vendor profile does not silently redirect a payout already requested.';
COMMENT ON COLUMN vendor_payouts.status IS 'requested = awaiting admin action; paid = admin marked it sent; rejected = admin declined it (money stays in the vendor''s available balance).';

CREATE TABLE IF NOT EXISTS vendor_ledger_adjustments (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_ledger_adjustments_vendor ON vendor_ledger_adjustments (vendor_id);

COMMENT ON TABLE vendor_ledger_adjustments IS 'Manual admin credits/debits to a vendor''s balance (goodwill credit, dispute correction, etc) - amount is signed: positive = credit, negative = debit.';
COMMENT ON COLUMN vendor_ledger_adjustments.reason IS 'Required free-text explanation, shown to the vendor alongside the amount - never a bare number with no context.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '067_vendor_wallet.sql',
    'vendor_payouts and vendor_ledger_adjustments: the only two wallet facts that cannot be derived from order_items - money actually paid out, and manual admin adjustments.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
