-- 114_order_item_consignment_fulfillment.sql
-- Consignment order-routing integration (-- September 2026) - the follow-up migration 110's header deliberately left
-- open: "routing a placed ORDER to fulfill straight from consigned_stock
-- (skipping the vendor per-order handover step) ... is left as a clearly-
-- flagged follow-up". checkoutController.js now does that: a plain
-- (non-variant) product with fulfillment_type='lizimas_fulfilled' and
-- enough consigned_stock to cover the whole line item skips
-- pending_handover/vendor_fulfilment_stage entirely and is inserted
-- already handover_status='accepted' (Lizimas already holds it physically -
-- it was counted in when the consignment was received), decrementing
-- consigned_stock alongside the existing products.stock decrement. If
-- consigned_stock can't cover the full quantity, the item falls back to
-- the normal vendor-handover flow unchanged - no split-fulfillment.
--
-- This column is purely an audit/reporting marker distinguishing "accepted
-- because Lizimas already had the stock" from a normal per-order handover
-- that an admin actually inspected - existing handover_status/
-- vendor_fulfilment_stage logic elsewhere doesn't need to know about it.

BEGIN;

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS fulfilled_from_consignment BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.fulfilled_from_consignment IS
    'true when this line item was auto-accepted at checkout from a vendor''s consigned_stock at a Lizimas hub (Fulfillment-by-Lizimas), instead of going through the normal pending_handover -> handed_over -> accepted vendor handover flow. See checkoutController.js.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '114_order_item_consignment_fulfillment.sql',
    'Consignment order-routing integration: order_items.fulfilled_from_consignment marker; checkoutController.js now routes lizimas_fulfilled products with enough consigned_stock straight to handover_status=accepted and decrements consigned_stock, closing the follow-up flagged in migration 110.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
