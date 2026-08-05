-- 012: Live chat - conversations and messages
-- Applied local: 2026-08-05
-- Applied Render:
--
-- Guests are identified by a random guest_token held in the browser. Anyone
-- holding the token can read that thread, so guest_name and guest_phone are
-- captured at chat start to give staff something to verify against.
--
-- Polling is cursor-based on chat_messages.id, not on timestamps: two messages
-- landing in the same second would be indistinguishable by created_at.
--
-- Unread counters are denormalised so the customer bubble and the staff inbox
-- badge can render without scanning the message table. The controller must
-- update them in the same transaction as the INSERT.

CREATE TABLE IF NOT EXISTS chat_conversations (
    id                SERIAL PRIMARY KEY,
    customer_id       INTEGER REFERENCES users (id) ON DELETE SET NULL,
    guest_token       VARCHAR(64),
    guest_name        VARCHAR(120),
    guest_phone       VARCHAR(32),
    subject           VARCHAR(160),
    status            VARCHAR(16) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'pending', 'closed')),
    assigned_staff_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    customer_unread   INTEGER NOT NULL DEFAULT 0,
    staff_unread      INTEGER NOT NULL DEFAULT 0,
    last_message_at   TIMESTAMP,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at         TIMESTAMP,

    -- A thread belongs to a logged-in customer or to a guest token, never neither.
    CONSTRAINT chat_conv_has_owner
        CHECK (customer_id IS NOT NULL OR guest_token IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL
                    REFERENCES chat_conversations (id) ON DELETE CASCADE,
    sender_type     VARCHAR(10) NOT NULL
                    CHECK (sender_type IN ('customer', 'staff', 'system')),
    sender_staff_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    body            TEXT NOT NULL,
    attachment_url  TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at         TIMESTAMP,

    CONSTRAINT chat_msg_body_not_blank
        CHECK (length(btrim(body)) > 0),

    -- A staff message must say which staff member sent it; a customer
    -- message must not carry a staff id.
    CONSTRAINT chat_msg_staff_attribution
        CHECK ((sender_type = 'staff'  AND sender_staff_id IS NOT NULL)
            OR (sender_type <> 'staff' AND sender_staff_id IS NULL))
);

-- The poll query: messages in this thread with id greater than the cursor.
CREATE INDEX IF NOT EXISTS idx_chat_messages_cursor
    ON chat_messages (conversation_id, id);

-- Guest token lookup on every guest poll. Partial so logged-in rows are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conv_guest_token
    ON chat_conversations (guest_token)
    WHERE guest_token IS NOT NULL;

-- Customer reopening the widget: find my most recent thread.
CREATE INDEX IF NOT EXISTS idx_chat_conv_customer
    ON chat_conversations (customer_id, last_message_at DESC)
    WHERE customer_id IS NOT NULL;

-- Staff inbox, ordered by activity, filtered by status.
CREATE INDEX IF NOT EXISTS idx_chat_conv_status
    ON chat_conversations (status, last_message_at DESC);

-- "My assigned threads" for a support agent.
CREATE INDEX IF NOT EXISTS idx_chat_conv_assigned
    ON chat_conversations (assigned_staff_id, status)
    WHERE assigned_staff_id IS NOT NULL;
