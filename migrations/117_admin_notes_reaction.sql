-- 117_admin_notes_reaction.sql
-- Adds a single WhatsApp-style emoji reaction to an admin note - a quick
-- sticker tap (one emoji per note, not a full reaction list), set/cleared
-- via PATCH /api/admin/notes/:id/reaction. Rendered as a small badge
-- overlapping the TOP of the note card (client/js/admin.js), matching
-- Ryan's "add stickers just as we see whatsapp... appear on top not
-- bottom part".

BEGIN;

ALTER TABLE public.admin_notes
    ADD COLUMN IF NOT EXISTS reaction VARCHAR(8);

COMMENT ON COLUMN public.admin_notes.reaction IS
    'Single emoji "sticker" on the note (WhatsApp-style quick reaction), NULL = none. Set/cleared via PATCH /api/admin/notes/:id/reaction, rendered as a badge overlapping the top edge of the note card.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '117_admin_notes_reaction.sql',
    'admin_notes.reaction: a single WhatsApp-style emoji sticker per note, shown as a badge over the top of the card.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
