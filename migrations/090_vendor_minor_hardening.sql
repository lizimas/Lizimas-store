-- 090_vendor_minor_hardening.sql
-- Two small fixes: enforce account_type and constrain channel_sync_log.action.

BEGIN;

UPDATE vendors SET account_type = 'individual' WHERE account_type IS NULL;
ALTER TABLE vendors ALTER COLUMN account_type SET NOT NULL;

DO $$
DECLARE bad_count int;
BEGIN
    SELECT count(*) INTO bad_count FROM channel_sync_log
    WHERE action NOT IN ('connect','disconnect','token_refresh','push','pull','import','reconcile');
    IF bad_count = 0 THEN
        ALTER TABLE channel_sync_log DROP CONSTRAINT IF EXISTS channel_sync_log_action_check;
        ALTER TABLE channel_sync_log ADD CONSTRAINT channel_sync_log_action_check
            CHECK (action IN ('connect','disconnect','token_refresh','push','pull','import','reconcile'));
    ELSE
        RAISE NOTICE 'Skipping channel_sync_log CHECK - % bad rows exist', bad_count;
    END IF;
END $$;

INSERT INTO schema_migrations (filename, note)
VALUES ('090_vendor_minor_hardening.sql',
        'vendors.account_type NOT NULL, channel_sync_log.action CHECK.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
