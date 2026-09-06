-- 059_staff_messages.sql
-- Internal staff <-> admin messaging (separate from the customer-facing
-- live-chat system in migrations/*chat*). One running thread per staff
-- member (product_staff / store_manager / customer_support), keyed by
-- staff_user_id: the staff member sends messages into their own thread,
-- an admin replies into the same thread. Gated end-to-end by app_settings
-- ('staff_messaging_enabled') so only an admin can switch it on - when off,
-- the staff-side widget doesn't render and the send endpoint refuses.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_settings (
    key         VARCHAR(100) PRIMARY KEY,
    value       TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  INTEGER REFERENCES public.users(id)
);

INSERT INTO public.app_settings (key, value)
VALUES ('staff_messaging_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.staff_messages (
    id             SERIAL PRIMARY KEY,
    staff_user_id  INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    sender_id      INTEGER NOT NULL REFERENCES public.users(id),
    sender_role    VARCHAR(30) NOT NULL,
    is_from_admin  BOOLEAN NOT NULL DEFAULT false,
    body           TEXT NOT NULL,
    read_by_staff  BOOLEAN NOT NULL DEFAULT false,
    read_by_admin  BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_messages_staff_user_id
    ON public.staff_messages (staff_user_id, created_at);

COMMENT ON TABLE public.staff_messages IS
    'One row per message in a staff member''s internal thread with admin. staff_user_id identifies whose thread it is; is_from_admin tells the direction. Independent of the customer-facing live-chat conversations table.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '059_staff_messages.sql',
    'app_settings (key/value) + staff_messages tables for the new internal staff<->admin messaging feature, gated by an admin-only on/off toggle.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
