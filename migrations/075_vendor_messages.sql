-- Vendor-to-admin messaging (Task #71).
--
-- Closes the gap flagged since Task #65: vendors had a one-way
-- notification feed (admin/system -> vendor) but no channel to raise a
-- question or issue back the other way, outside the specific structured
-- flows that already exist (return responses, compliance notices,
-- promotion proposals).
--
-- Deliberately minimal for a first version: a lightweight ticket/thread
-- model, not a real-time chat. A vendor opens one thread per issue with a
-- subject + first message; either side can reply; admin explicitly
-- marks a thread resolved/reopened. No per-reply read-tracking - the
-- vendor's existing notification bell (vendor_notifications, Tasks
-- #65/#70) is what tells them a reply landed; admin's inbox is a plain
-- list, the same "open queue, no unread system" pattern as every other
-- admin panel in this codebase (pending promotions, payout requests, ...).

CREATE TABLE IF NOT EXISTS vendor_messages (
    id          SERIAL PRIMARY KEY,
    vendor_id   INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    subject     VARCHAR(150) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_message_replies (
    id                  SERIAL PRIMARY KEY,
    vendor_message_id   INTEGER NOT NULL REFERENCES vendor_messages(id) ON DELETE CASCADE,
    sender_role         VARCHAR(10) NOT NULL CHECK (sender_role IN ('vendor', 'admin')),
    sender_user_id      INTEGER REFERENCES users(id),
    body                TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_messages_vendor_updated
    ON vendor_messages (vendor_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_messages_status_updated
    ON vendor_messages (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_message_replies_thread
    ON vendor_message_replies (vendor_message_id, created_at);

COMMENT ON TABLE vendor_messages IS 'A vendor-opened thread to reach admin outside the structured flows (returns, compliance, promotions) that already exist. status is admin-managed triage, not a hard lock on replying.';
COMMENT ON TABLE vendor_message_replies IS 'Ordered replies within one vendor_messages thread; sender_role/sender_user_id say who wrote each one.';

-- Adds admin_message as an 8th vendor_notifications type - fired when
-- admin replies, so the vendor's existing bell tells them to check their
-- Messages tab rather than requiring a second, separate unread system.
DO $$
DECLARE
    con_name text;
BEGIN
    -- Matched by which column the constraint actually references (conkey),
    -- not by pattern-matching its rendered text: Postgres silently rewrites
    -- "type IN (...)" into "type = ANY (ARRAY[...])" internally, so a
    -- '%IN%' text match against pg_get_constraintdef never fires and the
    -- old constraint is never dropped - caught when this was first run for
    -- real against Render (Sept 2026), fixed here before re-running.
    SELECT con.conname INTO con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att
      ON att.attrelid = rel.oid
     AND att.attnum = ANY (con.conkey)
    WHERE rel.relname = 'vendor_notifications'
      AND con.contype = 'c'
      AND att.attname = 'type'
      AND array_length(con.conkey, 1) = 1;

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE vendor_notifications DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

ALTER TABLE vendor_notifications
    ADD CONSTRAINT vendor_notifications_type_check CHECK (type IN (
        'new_order', 'low_stock', 'product_approved', 'product_rejected',
        'compliance_action', 'payout_update', 'refund_decision', 'admin_message'
    ));

INSERT INTO schema_migrations (filename, note)
VALUES (
    '075_vendor_messages.sql',
    'vendor_messages/vendor_message_replies: a minimal two-way ticket/thread channel for a vendor to reach admin outside the existing structured flows; vendor_notifications.type gains admin_message.'
)
ON CONFLICT (filename) DO NOTHING;
