-- 015_chat_escalation.sql
-- Stage 2 prerequisites: escalation vocabulary.
--
-- Three things the controller work needs and the schema does not yet allow:
--   1. sender_type = 'ai'   so the FAQ trail can live in the transcript
--   2. status = 'waiting'   so escalated chats queue instead of going straight to open
--   3. escalation_reason    so "why did the FAQ fail" is answerable
--
-- Check constraints are dropped by definition-match rather than by name, since
-- the sender_type constraint's name was never confirmed. NOT NULL constraints
-- are contype 'n' on this Postgres version and are left untouched by the
-- contype = 'c' filter.

BEGIN;

-- 1. sender_type: add 'ai' -------------------------------------------------

DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'chat_messages'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%sender_type%'
    LOOP
        EXECUTE format('ALTER TABLE chat_messages DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE chat_messages
    ADD CONSTRAINT chat_messages_sender_type_check
    CHECK (sender_type IN ('customer', 'staff', 'ai', 'system'));

-- 2. conversation status: add 'waiting' ------------------------------------

DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'chat_conversations'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
          AND pg_get_constraintdef(oid) NOT ILIKE '%closed_by_type%'
    LOOP
        EXECUTE format('ALTER TABLE chat_conversations DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE chat_conversations
    ADD CONSTRAINT chat_conversations_status_check
    CHECK (status IN ('waiting', 'open', 'pending', 'closed'));

-- 3. escalation_reason -----------------------------------------------------
--   said_no          customer answered No to "Did that answer it?"
--   asked_for_agent  customer went straight to the agent button
--   no_match         free-text question the topic tree could not match
--   other            reserved

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS escalation_reason VARCHAR(32);

ALTER TABLE chat_conversations
    DROP CONSTRAINT IF EXISTS chat_conv_escalation_reason_check;

ALTER TABLE chat_conversations
    ADD CONSTRAINT chat_conv_escalation_reason_check
    CHECK (escalation_reason IS NULL OR escalation_reason IN
        ('said_no', 'asked_for_agent', 'no_match', 'other'));

-- 4. queue drain wants the oldest waiting chat without a table scan --------

CREATE INDEX IF NOT EXISTS idx_chat_conv_waiting
    ON chat_conversations (escalated_at)
    WHERE status = 'waiting';

COMMIT;
