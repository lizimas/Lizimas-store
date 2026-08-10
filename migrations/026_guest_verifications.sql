-- ---------------------------------------------------------------------
-- 026_guest_verifications.sql
--
-- Contact verification for guests at checkout.
--
-- Guests have no users row, so 025's columns cannot serve them. This
-- table is keyed on the contact itself.
--
-- On success a token is issued; the checkout endpoint requires it and
-- consumes it. Without that, a client could verify once and then post
-- any number of orders, or verify one number and deliver to another.
--
-- The channel column is deliberately open to whatsapp as well as email
-- and sms: the sender is a swappable implementation, and which one is
-- live depends only on which credentials are configured.
-- ---------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS guest_verifications (
    id                  SERIAL PRIMARY KEY,

    -- Contact being proven. Phone is stored normalised to +256XXXXXXXXX
    -- so lookups and rate limits cannot be dodged by reformatting.
    phone               VARCHAR(30),
    email               VARCHAR(150),

    channel             VARCHAR(10) NOT NULL,
    target              TEXT        NOT NULL,

    otp_hash            TEXT        NOT NULL,
    expires_at          TIMESTAMP   NOT NULL,
    attempts            INTEGER     NOT NULL DEFAULT 0,

    -- Throttling. last_sent_at gates the 60s resend; the window pair
    -- caps bursts, which matters once a paid channel is live.
    last_sent_at        TIMESTAMP,
    send_count          INTEGER     NOT NULL DEFAULT 0,
    send_window_start   TIMESTAMP,

    verified_at         TIMESTAMP,

    -- Issued on success, required by checkout, consumed on use.
    token               TEXT,
    token_expires_at    TIMESTAMP,
    consumed_at         TIMESTAMP,

    request_ip          TEXT,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT guest_verifications_channel_check
        CHECK (channel IN ('email', 'sms', 'whatsapp')),

    -- Whichever channel is used, the matching contact must be present.
    CONSTRAINT guest_verifications_contact_check
        CHECK (
            (channel = 'email' AND email IS NOT NULL)
            OR (channel IN ('sms', 'whatsapp') AND phone IS NOT NULL)
        )
);

-- One live row per contact: a fresh request overwrites the outstanding
-- code rather than leaving several valid at once.
CREATE UNIQUE INDEX IF NOT EXISTS guest_verifications_phone_uniq
    ON guest_verifications (phone) WHERE phone IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guest_verifications_email_uniq
    ON guest_verifications (email) WHERE email IS NOT NULL;

-- Token lookup at checkout.
CREATE UNIQUE INDEX IF NOT EXISTS guest_verifications_token_uniq
    ON guest_verifications (token) WHERE token IS NOT NULL;

CREATE INDEX IF NOT EXISTS guest_verifications_created_idx
    ON guest_verifications (created_at);

COMMENT ON TABLE guest_verifications IS
  'Guest checkout contact verification. Rows are transient; safe to purge once consumed or expired.';

COMMENT ON COLUMN guest_verifications.target IS
  'The address or number the code was actually sent to. Checked again at submit so a changed contact cannot inherit a code.';

COMMIT;

-- ---------------------------------------------------------------------
-- Housekeeping
--
-- Not scheduled here -- run periodically, or from a job once one exists.
-- ---------------------------------------------------------------------
-- DELETE FROM guest_verifications
--  WHERE created_at < NOW() - INTERVAL '7 days';

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS guest_verification_rows FROM guest_verifications;

\d guest_verifications
