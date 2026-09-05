-- 052_vendor_fulfilment.sql
-- Vendor handover/inspection/returns tracking, per the Delivery, Fulfilment
-- and Packaging Guidelines: a vendor prepares an item and hands it to a
-- Lizimas Store drop-off point; Lizimas Store inspects and accepts/rejects
-- it there; once accepted, Lizimas Store (not the vendor) owns customer
-- delivery. If delivery fails or the customer returns the item, it comes
-- back to the same drop-off point for 7 days, then a central hub for a
-- further 14 days (21 total), after which it may be forfeited.
--
-- Scoped to order_items (not orders) because one order can mix items from
-- several vendors and from staff-managed stock; only vendor-sourced items
-- (product.vendor_id IS NOT NULL) ever get a handover_status set.

CREATE TABLE IF NOT EXISTS public.dropoff_points (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    address     TEXT NOT NULL,
    is_hub      BOOLEAN NOT NULL DEFAULT false,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dropoff_points IS
    'Physical locations vendors hand products to, and collect returned/failed-delivery inventory from. is_hub marks the central hub used for the second 14-day collection window.';

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS handover_status VARCHAR(30),
    ADD COLUMN IF NOT EXISTS dropoff_point_id INTEGER REFERENCES dropoff_points(id),
    ADD COLUMN IF NOT EXISTS handed_over_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS inspected_by INTEGER REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS inspected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS return_reason VARCHAR(30),
    ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS collection_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS forfeited_at TIMESTAMPTZ;

ALTER TABLE order_items
    DROP CONSTRAINT IF EXISTS order_items_handover_status_check;

ALTER TABLE order_items
    ADD CONSTRAINT order_items_handover_status_check
    CHECK (handover_status IS NULL OR handover_status IN (
        'pending_handover', 'handed_over', 'accepted', 'rejected',
        'returned_for_collection', 'collected', 'forfeited'
    ));

ALTER TABLE order_items
    DROP CONSTRAINT IF EXISTS order_items_return_reason_check;

ALTER TABLE order_items
    ADD CONSTRAINT order_items_return_reason_check
    CHECK (return_reason IS NULL OR return_reason IN (
        'failed_delivery', 'customer_return', 'damaged', 'defective', 'expired'
    ));

CREATE INDEX IF NOT EXISTS idx_order_items_handover_status
    ON order_items (handover_status)
    WHERE handover_status IS NOT NULL;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '052_vendor_fulfilment.sql',
    'dropoff_points table plus handover/inspection/returns-collection tracking on order_items, for vendor-sourced items.'
)
ON CONFLICT (filename) DO NOTHING;
