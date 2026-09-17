-- 116_admin_notes.sql
-- Admin-only reference notes ("Samsung Notes"-style scratchpad for the admin
-- role). Originated from an artifact-comment request asking for a shared
-- notes tool for staff+vendors, narrowed by Ryan to admin-only ("okay lets
-- build it only for the admin"). No staff/vendor visibility - gated by
-- requireAdmin exactly like promotions.js.
--
-- Deliberately simple: title + body + an optional colour tag (mirrors the
-- coloured-note-card idea from Samsung Notes) and a pin flag so admins can
-- keep a couple of notes at the top. No folders/notebooks for v1 - can be
-- added later if it's actually needed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_notes (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    color VARCHAR(20) NOT NULL DEFAULT 'default',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_pinned_updated
    ON public.admin_notes (pinned DESC, updated_at DESC);

COMMENT ON TABLE public.admin_notes IS
    'Admin-only reference notes (Samsung Notes-style scratchpad). Visible/editable only via requireAdmin-gated routes in server/routes/admin.js - never exposed to staff, vendors, or customers.';
COMMENT ON COLUMN public.admin_notes.color IS
    'Free-form colour tag for the note card (default, yellow, green, blue, pink, purple, gray, ...) - purely a client-side display hint, not constrained here.';
COMMENT ON COLUMN public.admin_notes.pinned IS
    'Pinned notes sort first in the admin Notes tab, mirroring a pinned note in Samsung Notes.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '116_admin_notes.sql',
    'admin_notes table: admin-only reference notes tool (title/body/color/pinned), requireAdmin-gated only, no staff or vendor access.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
