-- 104_order_item_refund_tier.sql
-- Phase 6 - Refund Tiers (Ryan, Sept 2026). Records which policy tier
-- applied to a return decision, alongside the existing refund_decision/
-- refund_amount columns - so "how many refunds did we approve outside
-- the normal window" is a query, not a guess, and so admin overriding
-- the tier-suggested amount leaves a visible trail rather than silently
-- diverging from policy. See server/utils/refundTiers.js for the tier
-- definitions and percentages.

BEGIN;

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS refund_tier VARCHAR(20),
    ADD COLUMN IF NOT EXISTS refund_tier_percentage SMALLINT,
    ADD COLUMN IF NOT EXISTS refund_tier_overridden BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'order_items_refund_tier_check'
    ) THEN
        ALTER TABLE order_items
            ADD CONSTRAINT order_items_refund_tier_check
            CHECK (refund_tier IS NULL OR refund_tier IN ('full', 'partial_high', 'partial_low', 'ineligible'));
    END IF;
END $$;

COMMENT ON COLUMN order_items.refund_tier IS
    'Which refund-tier bucket applied at decision time, based on days since delivered_at - see server/utils/refundTiers.js. NULL for returns decided before Phase 6 shipped.';
COMMENT ON COLUMN order_items.refund_tier_percentage IS
    'The tier''s suggested refund percentage (0-100) at decision time.';
COMMENT ON COLUMN order_items.refund_tier_overridden IS
    'true if the admin-approved refund_amount differs from the tier-suggested amount - admin retains final authority, this just makes a deviation visible for reporting.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '104_order_item_refund_tier.sql',
    'Phase 6: order_items.refund_tier/refund_tier_percentage/refund_tier_overridden - records which refund-tier policy applied to each decided return.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
