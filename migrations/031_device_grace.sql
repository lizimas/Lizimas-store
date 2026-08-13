-- 031_device_grace.sql
-- Unlocking an account is not enough on its own. A cleared security_locked_at
-- leaves the account with no trusted device, so the next login would lock it
-- again immediately. This column opens a short window during which a login is
-- allowed to enrol a device without being refused.
--
-- Set by the admin unlock action and by scripts/unlock-admin.js.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS device_grace_until TIMESTAMPTZ;

COMMIT;
