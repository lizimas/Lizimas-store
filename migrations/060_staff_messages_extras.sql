-- 060_staff_messages_extras.sql
-- Extends the internal staff <-> admin messaging feature (migrations/059)
-- with richer message types (stickers, file/document attachments) and a
-- lightweight online/last-seen presence tracker, to bring the staff-side
-- chat window up to a Messenger-style experience.

BEGIN;

ALTER TABLE public.staff_messages
    ADD COLUMN IF NOT EXISTS message_type     VARCHAR(20) NOT NULL DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS attachment_url   TEXT,
    ADD COLUMN IF NOT EXISTS attachment_name  TEXT,
    ADD COLUMN IF NOT EXISTS attachment_bytes INTEGER;

COMMENT ON COLUMN public.staff_messages.message_type IS
    'text | sticker | file - sticker renders the body (an emoji) large with no bubble background; file renders attachment_url/attachment_name as a download.';

-- One row per user, updated by a heartbeat call from the chat window while
-- it's open. "Admin" presence (shown to staff) is the MOST RECENT heartbeat
-- across every admin-role account, since any admin can pick up a thread.
CREATE TABLE IF NOT EXISTS public.staff_message_presence (
    user_id       INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '060_staff_messages_extras.sql',
    'Adds message_type/attachment columns to staff_messages and a staff_message_presence table, for stickers, file attachments and online/last-seen status in the staff<->admin chat window.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
