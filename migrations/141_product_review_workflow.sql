-- 141_product_review_workflow.sql
-- Product Approval page (Ryan, Sept 2026).
--  * products.status gains 'changes_requested' (vendor fixes and resubmits,
--    which puts it back to 'pending') and 'under_investigation' (hidden from
--    the store, vendor can't edit, until admin decides). There is no CHECK
--    on products.status, so nothing to alter for the values themselves.
--  * products.review_reason_code - the rejection / change-request reason
--    picked from the dropdown (rejection_reason keeps the text the vendor
--    sees). products.review_flags - admin flags such as
--    'suspected_counterfeit' and 'low_quality_images'.
--  * product_review_events - approval history: who moved a product from
--    which status to which, why, and when.
--  * product_review_notes - internal admin notes, never shown to vendors.
--  * market_price_checks - prices an admin recorded from another store
--    (Jumia Uganda) for comparison, with who recorded them and when.
--  * products.cost_price - what Lizimas pays for its own products (admin
--    only), so the review can show the margin. Vendor products use the
--    seller's payout instead.
--  * vendor_notifications.type gains 'product_review' (changes requested /
--    under investigation) and the types the code already sends
--    (admin_message, consignment_status, ad_campaign_status) that the old
--    CHECK was missing.
-- This file is safe to run more than once.

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS review_reason_code VARCHAR(40),
    ADD COLUMN IF NOT EXISTS review_flags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) CHECK (cost_price IS NULL OR cost_price >= 0);

CREATE TABLE IF NOT EXISTS public.product_review_events (
    id            BIGSERIAL PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    action        VARCHAR(30) NOT NULL,
    from_status   VARCHAR(30),
    to_status     VARCHAR(30),
    reason_code   VARCHAR(40),
    reason_text   TEXT,
    actor_id      INTEGER REFERENCES public.users(id),
    actor_name    TEXT,
    actor_role    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_review_events_product
    ON public.product_review_events (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.product_review_notes (
    id            BIGSERIAL PRIMARY KEY,
    product_id    INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    body          TEXT NOT NULL,
    author_id     INTEGER REFERENCES public.users(id),
    author_name   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_review_notes_product
    ON public.product_review_notes (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.market_price_checks (
    id             BIGSERIAL PRIMARY KEY,
    product_id     INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    source         VARCHAR(50) NOT NULL DEFAULT 'jumia.ug',
    search_term    VARCHAR(255),
    lowest_price   INTEGER,
    typical_price  INTEGER,
    highest_price  INTEGER,
    product_count  INTEGER,
    checked_by     INTEGER REFERENCES public.users(id),
    checked_by_name TEXT,
    checked_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_price_checks_product
    ON public.market_price_checks (product_id, checked_at DESC);

ALTER TABLE public.vendor_notifications DROP CONSTRAINT IF EXISTS vendor_notifications_type_check;
ALTER TABLE public.vendor_notifications
    ADD CONSTRAINT vendor_notifications_type_check CHECK (type IN (
        'new_order', 'low_stock', 'product_approved', 'product_rejected',
        'compliance_action', 'payout_update', 'refund_decision', 'admin_message',
        'kyc_status_change', 'consignment_status', 'ad_campaign_status', 'product_review'
    ));

INSERT INTO public.schema_migrations (filename, note)
VALUES ('141_product_review_workflow.sql', 'Product approval: changes_requested/under_investigation statuses, review reason + flags, review history, internal notes, market price checks, products.cost_price; vendor_notifications.type gains product_review.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
