-- Product rejection reason (Task #69).
--
-- rejectProduct has never collected a reason from admin - confirmed by
-- grep, this predates the vendor notification feed (Task #65), which had
-- to fall back to a generic "contact support" message for
-- product_rejected notifications because there was nothing real to show.
-- This column closes that gap; vendors table already has the same
-- pattern (migration 049).

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

INSERT INTO schema_migrations (filename, note)
VALUES (
    '073_product_rejection_reason.sql',
    'products.rejection_reason - the reason admin gives when rejecting a product submission, shown to the vendor instead of a generic fallback message.'
)
ON CONFLICT (filename) DO NOTHING;
