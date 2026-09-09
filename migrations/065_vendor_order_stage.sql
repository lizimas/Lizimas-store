-- 065_vendor_order_stage.sql
-- The vendor's OWN pre-handover progress on an order item: New -> Accepted
-- -> Processing -> Ready for Handover. Kept entirely separate from
-- handover_status (052_vendor_fulfilment.sql), which is Lizimas' own
-- post-handover inspection/returns lifecycle - handover_status already has
-- an 'accepted' value meaning "Lizimas accepted this item at inspection",
-- so reusing that name here for "the vendor accepted this order" would
-- collide two different meanings of "accepted" on the same row.

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS vendor_fulfilment_stage VARCHAR(20);

ALTER TABLE order_items
    DROP CONSTRAINT IF EXISTS order_items_vendor_fulfilment_stage_check;

ALTER TABLE order_items
    ADD CONSTRAINT order_items_vendor_fulfilment_stage_check
    CHECK (vendor_fulfilment_stage IS NULL OR vendor_fulfilment_stage IN (
        'new', 'accepted', 'processing', 'ready_for_handover'
    ));

COMMENT ON COLUMN order_items.vendor_fulfilment_stage IS
    'Vendor-controlled pre-handover progress (New/Accepted/Processing/Ready for Handover). NULL for staff-stocked items (no vendor_id) and for legacy rows from before this column existed. Distinct from handover_status, which is Lizimas'' own post-handover inspection/returns lifecycle.';

-- Backfill: vendor-sourced items still awaiting handover start at 'new' so
-- they show up correctly in the new vendor Orders tab. Anything already
-- past handover, or not vendor-sourced, is left untouched (NULL).
UPDATE order_items
SET vendor_fulfilment_stage = 'new'
WHERE handover_status = 'pending_handover' AND vendor_fulfilment_stage IS NULL;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '065_vendor_order_stage.sql',
    'order_items.vendor_fulfilment_stage: the vendor''s own pre-handover New/Accepted/Processing/Ready-for-Handover progress, kept separate from handover_status.'
)
ON CONFLICT (filename) DO NOTHING;
