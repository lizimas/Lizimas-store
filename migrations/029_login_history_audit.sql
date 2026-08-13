-- 029_login_history_audit.sql
-- Extends login_history so it can serve as the data source for the
-- admin Security tab: records attempts against non-existent accounts,
-- tags which portal was used, and states why an attempt failed.

BEGIN;

-- 1. Allow rows with no matching user, so attempts against emails that
--    do not exist in the system are still recorded. These are precisely
--    the attempts most worth seeing during a brute force.
ALTER TABLE login_history ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE login_history DROP CONSTRAINT IF EXISTS login_history_user_id_fkey;

-- 2. The email actually typed at the prompt. For a known account this
--    duplicates users.email, but it is the only record available when
--    user_id is NULL.
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS attempted_email VARCHAR(255);

-- 3. Which login portal the attempt came through.
--    'admin' | 'staff' | 'customer' | 'unknown'
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS surface VARCHAR(20);

-- 4. Why the attempt failed. NULL on success.
--    'wrong_password' | 'wrong_portal' | 'unknown_email'
--    | 'blocked' | 'inactive' | 'bad_2fa' | 'rate_limited'
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS failure_reason VARCHAR(50);

-- 5. Existing rows predate surface tracking.
UPDATE login_history SET surface = 'unknown' WHERE surface IS NULL;

-- 6. logged_in_at was 'timestamp without time zone', storing naive local
--    time while the rest of the schema uses TIMESTAMPTZ. Existing values
--    were written in Africa/Kampala, so they are interpreted as such.
ALTER TABLE login_history
    ALTER COLUMN logged_in_at TYPE TIMESTAMPTZ
    USING logged_in_at AT TIME ZONE 'Africa/Kampala';

ALTER TABLE login_history ALTER COLUMN logged_in_at SET DEFAULT NOW();

-- 7. Indexes for the Security tab, which reads recent rows per portal
--    and groups failures by the email attempted.
CREATE INDEX IF NOT EXISTS idx_login_history_surface_time
    ON login_history (surface, logged_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_history_attempted_email
    ON login_history (attempted_email)
    WHERE attempted_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_login_history_failures
    ON login_history (logged_in_at DESC)
    WHERE success = false;

COMMIT;
