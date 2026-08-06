-- Chat operations instrumentation.
--
-- Everything here exists so the admin dashboard has data to show. The
-- ordering matters: these columns must be written from the day the lifecycle
-- code lands, because none of them can be backfilled. "Average first response
-- time" is unknowable for any conversation that finished before the column
-- existed, so adding this late costs a permanent hole in the history.
--
-- Safe to re-run. Every statement is guarded.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Status vocabulary
--
-- 'waiting' is the state that makes the queue measurable: escalated, not yet
-- assigned. Without it, a customer who asked for a human is indistinguishable
-- from one happily reading FAQ answers, and "how many people need help right
-- now" cannot be answered.
-- ---------------------------------------------------------------------

ALTER TABLE chat_conversations
    DROP CONSTRAINT IF EXISTS chat_conversations_status_check;

ALTER TABLE chat_conversations
    ADD CONSTRAINT chat_conversations_status_check
    CHECK (status IN ('open', 'waiting', 'pending', 'closed'));

-- ---------------------------------------------------------------------
-- 2. Lifecycle timestamps
--
-- Each one is a single moment that a report later needs to subtract from
-- another. Nullable throughout - a conversation the AI resolved never gets
-- assigned_at, and that NULL is itself the signal that no agent touched it.
-- ---------------------------------------------------------------------

ALTER TABLE chat_conversations
    -- Customer asked for a human, or the AI gave up. Queue wait is measured
    -- from here, NOT from created_at: time spent reading FAQ answers is not
    -- time spent waiting, and conflating them makes the queue look far worse
    -- than it is.
    ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP,

    -- An agent took the conversation. escalated_at -> assigned_at is queue
    -- wait; the alert threshold watches this gap while it is still open.
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP,

    -- First staff reply. Distinct from assigned_at because claiming a chat
    -- and answering it are different acts, and an agent who claims six then
    -- answers none looks busy while helping nobody.
    ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP,

    -- Set when the conversation reaches a real conclusion, as opposed to
    -- being closed for tidiness or abandoned. Resolution rate divides this
    -- by total.
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,

    -- Who ended it. 'customer' means they simply left - an abandoned chat,
    -- which is the metric most worth watching and the one no other column
    -- captures.
    ADD COLUMN IF NOT EXISTS closed_by_type VARCHAR(16),

    ADD COLUMN IF NOT EXISTS closed_by_staff_id INTEGER,

    -- Drives abandonment detection and the "customer is waiting on us"
    -- sort in the agent inbox.
    ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMP,

    -- A conversation closed and then messaged again. High counts mean
    -- agents are closing things that were not actually resolved.
    ADD COLUMN IF NOT EXISTS reopened_count INTEGER NOT NULL DEFAULT 0,

    -- Optional link to an order, for the priority queue.
    ADD COLUMN IF NOT EXISTS order_id INTEGER;

DO $$
BEGIN
    ALTER TABLE chat_conversations
        ADD CONSTRAINT chat_conv_closed_by_type_check
        CHECK (closed_by_type IN ('ai', 'agent', 'customer', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE chat_conversations
        ADD CONSTRAINT chat_conv_closed_by_staff_fkey
        FOREIGN KEY (closed_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ON DELETE SET NULL rather than CASCADE: deleting an order must never take
-- the support conversation about it with them. The chat is the record of what
-- went wrong, and it outlives the order.
DO $$
BEGIN
    ALTER TABLE chat_conversations
        ADD CONSTRAINT chat_conv_order_fkey
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Priority queue: order-linked conversations sort ahead of general enquiries.
CREATE INDEX IF NOT EXISTS idx_chat_conv_order
    ON chat_conversations (order_id)
    WHERE order_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Agent availability
--
-- last_heartbeat is the important column. "is_available = true" on its own
-- is a claim the agent made once and may have walked away from ten minutes
-- ago; routing to a closed laptop drops customers into a queue nobody is
-- watching, which is worse than telling them no agent is free. Treat
-- availability as expired when the heartbeat is older than ~90 seconds.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_availability (
    staff_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_available    BOOLEAN   NOT NULL DEFAULT FALSE,
    last_heartbeat  TIMESTAMP,
    -- Ceiling on concurrent chats, so least-busy routing does not pile a
    -- seventh conversation onto someone already drowning.
    max_concurrent  INTEGER   NOT NULL DEFAULT 4,
    went_available_at TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 4. Event log
--
-- Append-only. The columns above hold current state and answer "how long did
-- this take"; this table answers "what happened, in what order, to whom" -
-- reassignments, reopens, availability flips. Those are invisible in a state
-- column, which only ever remembers the latest value.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_events (
    id              SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES chat_conversations(id) ON DELETE CASCADE,
    event_type      VARCHAR(40) NOT NULL,
    actor_type      VARCHAR(16),
    actor_staff_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- Free-form per event type: from/to agent on reassign, topic key on an
    -- FAQ answer, threshold breached on an alert.
    meta            JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 5. Alert throttle
--
-- One row. Render can restart the process or run more than one instance, so
-- "last digest sent" cannot live in memory - it would reset on deploy and
-- send duplicates from each instance.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_alert_state (
    id             INTEGER PRIMARY KEY DEFAULT 1,
    last_digest_at TIMESTAMP,
    CONSTRAINT chat_alert_state_single_row CHECK (id = 1)
);

INSERT INTO chat_alert_state (id, last_digest_at)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 6. Indexes
--
-- Written for the three queries the dashboard runs constantly: drain the
-- queue oldest-first, count a given agent's open load, and read one
-- conversation's history.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_chat_conv_waiting
    ON chat_conversations (escalated_at)
    WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS idx_chat_conv_agent_load
    ON chat_conversations (assigned_staff_id)
    WHERE status IN ('open', 'pending');

CREATE INDEX IF NOT EXISTS idx_chat_conv_created_at
    ON chat_conversations (created_at);

CREATE INDEX IF NOT EXISTS idx_chat_events_conv
    ON chat_events (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_events_type_time
    ON chat_events (event_type, created_at);

CREATE INDEX IF NOT EXISTS idx_staff_avail_live
    ON staff_availability (is_available, last_heartbeat);

COMMIT;
