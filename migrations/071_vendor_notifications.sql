-- Vendor Notifications (Task #65).
--
-- A structured, in-dashboard notification feed: new order, low stock,
-- product approved/rejected, a compliance action (Task #63), a payout
-- being paid/rejected (Task #61). Every notification is a plain row here -
-- compliance actions and payouts already have their own detailed vendor-
-- visible views (Notices, Wallet), this table is what lets a vendor see
-- at a glance, from anywhere in the dashboard, that something happened.

CREATE TABLE IF NOT EXISTS vendor_notifications (
    id          SERIAL PRIMARY KEY,
    vendor_id   INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL CHECK (type IN (
        'new_order', 'low_stock', 'product_approved', 'product_rejected',
        'compliance_action', 'payout_update'
    )),
    title       VARCHAR(150) NOT NULL,
    message     TEXT NOT NULL,
    link_tab    VARCHAR(30),
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_notifications_vendor_created
    ON vendor_notifications (vendor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vendor_notifications_unread
    ON vendor_notifications (vendor_id) WHERE read_at IS NULL;

COMMENT ON TABLE vendor_notifications IS 'In-dashboard notification feed for a vendor - link_tab names which dashboard tab the client should jump to when the notification is clicked.';

INSERT INTO schema_migrations (filename, description)
VALUES (
    '071_vendor_notifications.sql',
    'vendor_notifications: structured in-dashboard feed (new order, low stock, product approved/rejected, compliance action, payout update).'
)
ON CONFLICT (filename) DO NOTHING;
