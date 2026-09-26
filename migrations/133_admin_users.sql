-- 133_admin_users.sql
-- Admin panel Users & Permissions (Ryan, Sept 2026) - the admin-side twin
-- of the Vendor Center's Manage Users. The owner (role 'admin') invites
-- team members with role 'admin_staff' and ticks which admin sections each
-- may use (users.admin_permissions, ap_* codes - see
-- server/utils/adminPermissions.js). Only the owner can manage these users.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions TEXT[];

-- If users.role has a CHECK constraint, recreate it so it also allows
-- 'admin_staff' (keeping every role already in use).
DO $$
DECLARE
    c RECORD;
    roles TEXT;
BEGIN
    FOR c IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
        SELECT string_agg(quote_literal(r), ', ') INTO roles FROM (
            SELECT unnest(ARRAY['customer','admin','admin_staff','product_staff','store_manager',
                                'customer_support','vendor','vendor_staff']) AS r
            UNION
            SELECT DISTINCT role FROM users WHERE role IS NOT NULL
        ) x;
        EXECUTE 'ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (' || roles || '))';
    END LOOP;
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '133_admin_users.sql',
    'users.admin_permissions + admin_staff role for admin panel Users & Permissions.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
