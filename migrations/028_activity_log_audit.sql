-- Extend activity_log into a proper audit trail.
-- Existing rows and the four current call sites are unaffected: every new
-- column is nullable and the old signature still works.

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS actor_role  TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS actor_email TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS before_data JSONB;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS after_data  JSONB;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ip_address  TEXT;

-- Dotted action names outgrow 50 characters quickly.
ALTER TABLE activity_log ALTER COLUMN action      TYPE TEXT;
ALTER TABLE activity_log ALTER COLUMN target_type TYPE TEXT;

-- A deleted staff account must not take its trail with it, and must not be
-- blocked from deletion by it either. actor_email carries attribution on.
ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_user_id_fkey;

CREATE INDEX IF NOT EXISTS idx_activity_actor
    ON activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_target
    ON activity_log (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_action
    ON activity_log (action, created_at DESC);

-- Append-only. Irreversible without dropping the table: nothing here can be
-- corrected or removed after the fact, which is the point.
CREATE OR REPLACE RULE activity_log_no_update AS
    ON UPDATE TO activity_log DO INSTEAD NOTHING;

CREATE OR REPLACE RULE activity_log_no_delete AS
    ON DELETE TO activity_log DO INSTEAD NOTHING;

DROP TABLE IF EXISTS audit_log;
