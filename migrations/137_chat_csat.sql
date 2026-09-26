-- 137_chat_csat.sql
-- Support Phase 4 (Ryan, Sept 2026): customer satisfaction. When a chat is
-- closed the customer is asked "How did we do?" (1-5 stars + optional
-- comment). Feeds the Support Team Performance and Analytics screens.

BEGIN;

ALTER TABLE public.chat_conversations
    ADD COLUMN IF NOT EXISTS csat_score SMALLINT CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS csat_comment TEXT,
    ADD COLUMN IF NOT EXISTS csat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_conv_csat_at ON public.chat_conversations (csat_at) WHERE csat_score IS NOT NULL;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('137_chat_csat.sql', 'chat_conversations.csat_score/csat_comment/csat_at (customer rating after a chat).')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
