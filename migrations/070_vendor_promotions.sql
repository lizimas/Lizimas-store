-- Vendor Promotions: propose, admin-approved (Task #64).
--
-- A vendor proposes a time-boxed sale price on one of their own products;
-- Lizimas admin approves or rejects it, and separately controls whether an
-- approved promotion also gets homepage flash-sale placement. Reuses the
-- existing flash_sales/flash_sale_items machinery (migration 057) for
-- homepage placement rather than building a second homepage section -
-- see PENDING.md for how the two connect.
--
-- Deliberately does NOT let a vendor propose a store-wide discount CODE:
-- discount_codes (migration 056) apply to the whole order at checkout,
-- which can include other vendors' items - a single vendor choosing that
-- discount would be setting a price on money that isn't only theirs. Only
-- admin creates those, unchanged.

CREATE TABLE IF NOT EXISTS vendor_promotions (
    id                  SERIAL PRIMARY KEY,
    vendor_id           INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    original_price       NUMERIC(10,2) NOT NULL,
    proposed_sale_price NUMERIC(10,2) NOT NULL CHECK (proposed_sale_price > 0),
    starts_at           TIMESTAMPTZ NOT NULL,
    ends_at             TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason    TEXT,
    reviewed_by         INTEGER REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    homepage_featured   BOOLEAN NOT NULL DEFAULT false,
    sponsored           BOOLEAN NOT NULL DEFAULT false,
    flash_sale_item_id  INTEGER REFERENCES flash_sale_items(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vendor_promotions_window_check CHECK (ends_at > starts_at),
    CONSTRAINT vendor_promotions_discount_check CHECK (proposed_sale_price < original_price)
);

CREATE INDEX IF NOT EXISTS idx_vendor_promotions_vendor ON vendor_promotions (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_promotions_status ON vendor_promotions (status);
CREATE INDEX IF NOT EXISTS idx_vendor_promotions_product_active
    ON vendor_promotions (product_id) WHERE status = 'approved';

COMMENT ON TABLE vendor_promotions IS 'Vendor-proposed, admin-approved time-boxed sale price on one of the vendor''s own products. original_price is snapshotted at proposal time so a later price edit does not retroactively change what discount % was actually approved.';
COMMENT ON COLUMN vendor_promotions.homepage_featured IS 'Admin-only: whether an approved promotion also gets a row in flash_sale_items (the existing homepage flash-sale section), via flash_sale_item_id. Independent of approval itself - an approved promotion still shows its sale price on the product page even when not featured.';
COMMENT ON COLUMN vendor_promotions.sponsored IS 'Admin-only flag reserved for future sponsored-placement/search-boost - stored now, no placement mechanic wired to it yet.';
COMMENT ON COLUMN vendor_promotions.flash_sale_item_id IS 'Set only when homepage_featured is true - the flash_sale_items row this promotion materialized into. Cleared automatically if that row is deleted (ON DELETE SET NULL).';

INSERT INTO schema_migrations (filename, description)
VALUES (
    '070_vendor_promotions.sql',
    'vendor_promotions: vendor-proposed sale price on their own product, admin approve/reject, admin-controlled homepage_featured (materializes into flash_sale_items) and sponsored flag.'
)
ON CONFLICT (filename) DO NOTHING;
