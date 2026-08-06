-- Guest email on the conversation record.
--
-- The chat contact form already collects an email, but it only survived as
-- text inside the first message. Staff could read it but nothing could use
-- it: no lookup, no receipt, no follow-up when the customer closes the tab.
--
-- Nullable on purpose. Email is optional in the form and most guests will
-- skip it; a NOT NULL here would break every conversation started without one.

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255);

COMMENT ON COLUMN chat_conversations.guest_email IS
    'Optional email given by a guest in the chat contact form. NULL for signed-in customers - use users.email instead.';
