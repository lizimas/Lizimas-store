-- 030_trusted_devices.sql
-- Device recognition, phase A: storage only.
--
-- On every successful login the server mints a random device token, stores
-- its SHA-256 hash here, and returns the raw token to the browser as an
-- httpOnly cookie. Nothing is enforced yet - enforcement is a separate
-- deploy gated on DEVICE_LOCK_ENFORCED, once real browsers are enrolled.

BEGIN;

CREATE TABLE IF NOT EXISTS trusted_devices (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- SHA-256 of the raw cookie value. The raw token is never stored, so a
    -- database leak does not yield usable device credentials.
    token_hash      CHAR(64) NOT NULL UNIQUE,

    -- Descriptive only. Never used to decide whether a device is trusted.
    device_label    VARCHAR(255),
    ip_address      VARCHAR(45),

    -- How this device came to be trusted. Only 'cookie' exists in phase A;
    -- the column is here so later paths (admin approval, customer email
    -- confirmation) are distinguishable at a glance.
    origin          VARCHAR(20) NOT NULL DEFAULT 'cookie',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user
    ON trusted_devices (user_id);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_active
    ON trusted_devices (token_hash)
    WHERE revoked_at IS NULL;

-- Set when a login is refused for coming from an unrecognised device.
-- Distinct from blocked_at, which is an administrative action: a locked
-- account is a security event awaiting review, not a disabled one.
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_locked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_locked_reason VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_users_security_locked
    ON users (security_locked_at)
    WHERE security_locked_at IS NOT NULL;

COMMIT;
