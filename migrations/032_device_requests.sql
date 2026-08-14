-- 032_device_requests.sql
-- Device recognition, phase 4c: an unrecognised device raises a pending
-- request instead of locking the account outright. The owner approves or
-- denies from an emailed link; the waiting browser polls and advances on
-- its own. This supersedes the phase B hard refusal.
--
-- Nothing here is a bearer credential in plaintext: the browser reference
-- and both decision tokens are stored as SHA-256, exactly as trusted_devices
-- stores its cookie.

BEGIN;

CREATE TABLE IF NOT EXISTS device_requests (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Held by the browser that started the login, used only to poll status.
    ref_hash            CHAR(64) NOT NULL UNIQUE,

    -- Carried in the emailed links. Separate tokens so a denial link can
    -- never be replayed as an approval.
    approve_token_hash  CHAR(64) NOT NULL UNIQUE,
    deny_token_hash     CHAR(64) NOT NULL UNIQUE,

    status              VARCHAR(20) NOT NULL DEFAULT 'pending',

    -- Context shown on the approval page so the decision is an informed one.
    surface             VARCHAR(20),
    ip_address          VARCHAR(45),
    user_agent          TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    decided_at          TIMESTAMPTZ,
    consumed_at         TIMESTAMPTZ,

    CONSTRAINT device_requests_status_chk
        CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed'))
);

CREATE INDEX IF NOT EXISTS idx_device_requests_user
    ON device_requests (user_id);

-- One live request per account at a time; older ones are expired on insert.
CREATE INDEX IF NOT EXISTS idx_device_requests_pending
    ON device_requests (user_id, expires_at)
    WHERE status = 'pending';

COMMIT;
