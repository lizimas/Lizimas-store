-- 098_order_items_delivered_at.sql
-- Phase 4 - Billing Cycles needs a per-item delivery timestamp to attribute
-- each earning to the correct bi-weekly cycle. orders only has created_at
-- and paid_at, so we add delivered_at to order_items.
--
-- Backfill: for existing order_items whose parent order is already
-- status='delivered', use orders.created_at as the best available proxy
-- (we don't know the real historical delivery time). All such items are
-- pre-Phase-4 anyway, so they won't be included in any statement unless
-- they fall inside the first cycle's period.

BEGIN;

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_order_items_delivered_at
    ON order_items (delivered_at)
    WHERE delivered_at IS NOT NULL;

COMMENT ON COLUMN order_items.delivered_at IS
    'When this item''s parent order was marked delivered. Set by updateOrderStatus in adminController.js. Drives Phase 4 billing cycle attribution.';

-- Backfill: any item whose parent order is already delivered, but with a
-- NULL delivered_at, gets the order''s created_at as a rough proxy.
UPDATE order_items oi
SET delivered_at = o.created_at
FROM orders o
WHERE oi.order_id = o.id
  AND o.status = 'delivered'
  AND oi.delivered_at IS NULL;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '098_order_items_delivered_at.sql',
    'Phase 4: order_items.delivered_at - per-item delivery timestamp for billing cycle attribution.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
