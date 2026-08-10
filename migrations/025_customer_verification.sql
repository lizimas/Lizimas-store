-- ---------------------------------------------------------------------
-- 025_customer_verification.sql
--
-- Contact verification for customers, required before checkout.
--
-- Deliberately does NOT reuse the existing email_otp_* columns. Those
-- serve the 2FA login fallback; a customer verifying their address
-- while a login code was outstanding would overwrite their own code and
-- lock themselves out of the login they were part-way through.
--
-- verification_target stores the address or number the code was sent
-- to. Without it, a customer could request a code, change their email,
-- then submit the code and verify an address that never received one.
-- Verification must bind to the target, not just the user.
-- ---------------------------------------------------------------------

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at             TIMESTAMP,
  ADD COLUMN IF NOT EXISTS phone_verified_at             TIMESTAMP,
  ADD COLUMN IF NOT EXISTS verification_otp_hash         TEXT,
  ADD COLUMN IF NOT EXISTS verification_otp_expires_at   TIMESTAMP,
  ADD COLUMN IF NOT EXISTS verification_otp_attempts     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_otp_last_sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS verification_channel          VARCHAR(10),
  ADD COLUMN IF NOT EXISTS verification_target           TEXT;

-- Only two channels are ever valid. NULL means no code outstanding.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_verification_channel_check;

ALTER TABLE users
  ADD CONSTRAINT users_verification_channel_check
  CHECK (verification_channel IS NULL
         OR verification_channel IN ('email', 'sms'));

COMMENT ON COLUMN users.verification_target IS
  'Address or number the outstanding code was sent to. Verification is only applied if this still matches the account at submit time.';

-- ---------------------------------------------------------------------
-- Grandfathering
--
-- Customers who have already completed an order have demonstrably
-- reachable contact details, and blocking them at checkout would be a
-- regression for people who have done nothing wrong. Everyone else
-- verifies on their next checkout.
--
-- Staff roles are marked verified outright: they authenticate through
-- the staff flow with enforced 2FA and never touch customer checkout.
-- ---------------------------------------------------------------------
UPDATE users u
   SET email_verified_at = COALESCE(u.email_verified_at, NOW())
 WHERE u.email_verified_at IS NULL
   AND (
        u.role <> 'customer'
        OR EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
       );

COMMIT;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT
    COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified_accounts,
    COUNT(*) FILTER (WHERE email_verified_at IS NULL)     AS pending_accounts,
    COUNT(*)                                              AS total_accounts
  FROM users
 WHERE deleted_at IS NULL;

SELECT id, email, role, email_verified_at
  FROM users
 WHERE deleted_at IS NULL
   AND email_verified_at IS NULL
 ORDER BY id;
