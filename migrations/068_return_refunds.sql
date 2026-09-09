-- Returns & Refunds Center (Task #62).
--
-- Builds on the reverse-logistics tracking migration 052 already put on
-- order_items (handover_status, return_reason, collection_deadline, ...),
-- which only covers the PHYSICAL side: getting an item back from the
-- customer to a vendor. This adds the FINANCIAL/decision side that was
-- entirely missing - a photo of the returned item's condition, Lizimas'
-- approve/deny refund decision and recorded amount, and a place for the
-- vendor to see and respond to that decision.
--
-- refund_amount is a RECORDED figure - what Lizimas manually refunded the
-- customer via the payment gateway/MoMo dashboard - not an automatic
-- gateway refund call. Same manual-confirmation pattern as vendor_payouts
-- (migration 067): admin confirms money moved out of band, this table
-- doesn't move it.

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS return_evidence_image VARCHAR(500),
    ADD COLUMN IF NOT EXISTS refund_decision VARCHAR(20),
    ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS refund_notes TEXT,
    ADD COLUMN IF NOT EXISTS refund_decided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refund_decided_by INTEGER REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS vendor_response TEXT,
    ADD COLUMN IF NOT EXISTS vendor_responded_at TIMESTAMPTZ;

ALTER TABLE order_items
    DROP CONSTRAINT IF EXISTS order_items_refund_decision_check;

ALTER TABLE order_items
    ADD CONSTRAINT order_items_refund_decision_check
    CHECK (refund_decision IS NULL OR refund_decision IN ('approved', 'denied'));

COMMENT ON COLUMN order_items.return_evidence_image IS 'Admin-attached photo of the returned item''s condition (Cloudinary URL), shown to the vendor alongside the return reason.';
COMMENT ON COLUMN order_items.refund_decision IS 'NULL = awaiting Lizimas'' decision. Set once by admin and not changed afterwards - Lizimas/admin retains final authority over the outcome.';
COMMENT ON COLUMN order_items.refund_amount IS 'What Lizimas recorded as refunded to the customer - a manual record, not an automatic payment-gateway refund.';
COMMENT ON COLUMN order_items.vendor_response IS 'The vendor''s own comment/dispute on this return - visible to admin, does not change the refund decision itself.';

CREATE INDEX IF NOT EXISTS idx_order_items_refund_pending
    ON order_items (return_reason)
    WHERE return_reason IS NOT NULL AND refund_decision IS NULL;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '068_return_refunds.sql',
    'order_items gains return_evidence_image, refund_decision/amount/notes, and vendor_response - the financial/decision side of returns that migration 052''s physical-logistics tracking did not cover.'
)
ON CONFLICT (filename) DO NOTHING;
