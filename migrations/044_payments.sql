-- 044_payments.sql
-- Provider-agnostic payment attempts + append-only provider event log.
-- Amounts are stored in the currency's smallest unit. UGX is zero-decimal,
-- so amount_minor is whole shillings.

BEGIN;

CREATE TABLE IF NOT EXISTS payments (
    id                BIGSERIAL PRIMARY KEY,
    order_id          BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,

    provider          TEXT        NOT NULL,          -- 'mtn_momo' | 'airtel' | 'flutterwave' | 'pesapal'
    -- external_ref is OUR id, generated before the request leaves the server.
    -- For MTN this is the X-Reference-Id and the status-lookup key.
    external_ref      UUID        NOT NULL,
    -- provider_ref is THEIRS (financialTransactionId, flw_ref, OrderTrackingId...).
    provider_ref      TEXT,

    status            TEXT        NOT NULL DEFAULT 'pending',
    amount_minor      BIGINT      NOT NULL CHECK (amount_minor > 0),
    currency          TEXT        NOT NULL,

    payer_msisdn      TEXT,                          -- E.164, no '+' for MTN
    payer_message     TEXT,

    failure_code      TEXT,
    failure_reason    TEXT,

    -- reconciliation bookkeeping
    poll_attempts     INTEGER     NOT NULL DEFAULT 0,
    last_polled_at    TIMESTAMPTZ,
    next_poll_at      TIMESTAMPTZ,

    initiated_at      TIMESTAMPTZ,
    settled_at        TIMESTAMPTZ,                   -- succeeded/failed/expired/cancelled

    request_payload   JSONB,
    last_status_body  JSONB,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT payments_status_chk CHECK (status IN (
        'pending','initiated','succeeded','failed','expired','cancelled','refunded'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_external_ref_uq
    ON payments (provider, external_ref);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_ref_uq
    ON payments (provider, provider_ref)
    WHERE provider_ref IS NOT NULL;

-- At most one live attempt per order. A customer retrying after a failure is fine;
-- two simultaneous prompts on the same order is not.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_live_attempt_per_order
    ON payments (order_id)
    WHERE status IN ('pending','initiated');

-- Drives the reconciler queue.
CREATE INDEX IF NOT EXISTS payments_due_for_poll
    ON payments (next_poll_at)
    WHERE status IN ('pending','initiated');

CREATE INDEX IF NOT EXISTS payments_order_id_idx ON payments (order_id);


-- Append-only. Every callback and every poll result lands here, applied or not.
CREATE TABLE IF NOT EXISTS payment_events (
    id            BIGSERIAL PRIMARY KEY,
    payment_id    BIGINT      REFERENCES payments(id) ON DELETE SET NULL,
    provider      TEXT        NOT NULL,

    -- Stable per-delivery key for dedupe. Derived by the adapter: a provider
    -- event id if they send one, otherwise sha256 of the raw body.
    event_key     TEXT        NOT NULL,
    source        TEXT        NOT NULL,   -- 'webhook' | 'poll' | 'manual'

    from_status   TEXT,
    to_status     TEXT,
    applied       BOOLEAN     NOT NULL DEFAULT FALSE,
    ignored_reason TEXT,                  -- why a legal-looking event was dropped

    headers       JSONB,
    body          JSONB,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_dedupe_uq
    ON payment_events (provider, event_key);

CREATE INDEX IF NOT EXISTS payment_events_payment_id_idx
    ON payment_events (payment_id, received_at DESC);

-- Append-only enforcement, matching the activity_log approach.
CREATE OR REPLACE RULE payment_events_no_update AS
    ON UPDATE TO payment_events DO INSTEAD NOTHING;
CREATE OR REPLACE RULE payment_events_no_delete AS
    ON DELETE TO payment_events DO INSTEAD NOTHING;

COMMIT;
