-- 103_vendor_payment_instruments.sql
-- Phase 5 - Payment Instrument Approval (Ryan, Sept 2026 - modelled on
-- the channel's Vendor Center payout-account verification).
--
-- Why: the existing payout guard (markStatementPaid) only checks KYC
-- STATUS - whether this vendor's identity is verified - never WHERE the
-- money is actually going. vendors.momo_number can be changed by the
-- vendor at any time with no review, so a fully KYC-verified vendor could
-- still redirect every future payout to an unverified number. This table
-- adds a reviewed, name-matched, locked-once-in-review payout account
-- concept sitting ABOVE vendors.momo_number, which stays as-is for
-- backward compatibility (existing MoMo integration/display) but is no
-- longer what a payout is trusted against once a vendor has an approved
-- instrument - see server/controllers/billingController.js's
-- markStatementPaid guard.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_payment_instruments (
    id                      SERIAL PRIMARY KEY,
    vendor_id               INTEGER NOT NULL REFERENCES public.vendors(id),
    method                  VARCHAR(20) NOT NULL CHECK (method IN ('momo', 'bank')),
    -- MoMo fields
    momo_number             VARCHAR(20),
    -- Bank fields
    bank_name               VARCHAR(100),
    account_number          VARCHAR(50),
    account_holder_name     VARCHAR(200) NOT NULL,
    -- Status
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason        TEXT,
    is_preferred            BOOLEAN NOT NULL DEFAULT false,
    reviewed_by             INTEGER REFERENCES public.users(id),
    reviewed_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_instruments_vendor ON public.vendor_payment_instruments (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payment_instruments_status ON public.vendor_payment_instruments (status);

COMMENT ON TABLE public.vendor_payment_instruments IS
    'Reviewed vendor payout accounts (MoMo or bank), name-matched against the vendor''s verified legal name at submission. pending/approved are locked from direct edits - only a rejected instrument can be edited and resubmitted. See server/utils/vendorPaymentInstruments.js for the name-match and edit-lock rules.';

ALTER TABLE public.vendors
    ADD COLUMN IF NOT EXISTS preferred_instrument_id INTEGER REFERENCES public.vendor_payment_instruments(id);

COMMENT ON COLUMN public.vendors.preferred_instrument_id IS
    'Which vendor_payment_instruments row payouts go to. markStatementPaid (billingController.js) refuses to mark a statement paid unless this points at an approved instrument.';

CREATE TABLE IF NOT EXISTS public.vendor_payment_instrument_audit_log (
    id              SERIAL PRIMARY KEY,
    instrument_id   INTEGER NOT NULL REFERENCES public.vendor_payment_instruments(id) ON DELETE CASCADE,
    from_status     VARCHAR(20),
    to_status       VARCHAR(20) NOT NULL,
    changed_by      INTEGER REFERENCES public.users(id),
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_instrument_audit_log_instrument
    ON public.vendor_payment_instrument_audit_log (instrument_id, created_at DESC);

COMMENT ON TABLE public.vendor_payment_instrument_audit_log IS
    'Who changed a payment instrument''s status, from what to what, and when. changed_by NULL means the auto-reject-on-name-mismatch path at submission, not an admin action.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '103_vendor_payment_instruments.sql',
    'Phase 5: vendor_payment_instruments (name-matched, reviewed payout accounts), vendors.preferred_instrument_id, vendor_payment_instrument_audit_log.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
