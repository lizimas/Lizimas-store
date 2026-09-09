-- Vendor reviews view + admin compliance actions (Task #63).
--
-- Two unrelated but similarly-shaped pieces sharing one migration:
--   1. A vendor can now see and respond to reviews on their own products
--      (product_reviews gains vendor_response, same "vendor can respond,
--      never change the underlying record" pattern as returns/refunds -
--      Task #62).
--   2. Admin compliance actions against a vendor: warn, suspend/reinstate
--      (vendors.status already supported 'suspended' but nothing ever set
--      it), restrict/unrestrict one product, freeze/unfreeze payouts.

ALTER TABLE product_reviews
    ADD COLUMN IF NOT EXISTS vendor_response TEXT,
    ADD COLUMN IF NOT EXISTS vendor_response_at TIMESTAMPTZ;

COMMENT ON COLUMN product_reviews.vendor_response IS 'The selling vendor''s own reply to this review - visible publicly alongside it, never edits the review itself.';

ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS payout_frozen BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN vendors.payout_frozen IS 'Admin compliance action: blocks new payout requests (see vendor_compliance_actions) without changing vendors.status. An outstanding request already submitted is unaffected - admin still marks it paid/rejected as usual.';

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS admin_restricted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS restricted_reason TEXT;

COMMENT ON COLUMN products.admin_restricted IS 'Admin compliance action, independent of the vendor''s own is_active toggle (Task #60) - a restricted product stays off the public catalogue even if the vendor tries to reactivate it. Cleared only by an admin unrestrict_product action.';

CREATE INDEX IF NOT EXISTS idx_products_admin_restricted
    ON products (vendor_id) WHERE admin_restricted = true;

CREATE TABLE IF NOT EXISTS vendor_compliance_actions (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    action_type VARCHAR(20) NOT NULL CHECK (action_type IN (
        'warn', 'suspend', 'reinstate',
        'restrict_product', 'unrestrict_product',
        'freeze_payout', 'unfreeze_payout'
    )),
    reason TEXT NOT NULL,
    product_id INTEGER REFERENCES products(id),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_compliance_actions_vendor ON vendor_compliance_actions (vendor_id);

COMMENT ON TABLE vendor_compliance_actions IS 'Audit trail AND vendor-visible notice feed for admin compliance actions - a warning has no schema effect elsewhere, so this table is the only record of it.';
COMMENT ON COLUMN vendor_compliance_actions.product_id IS 'Set only for restrict_product/unrestrict_product - which product the action applied to.';

INSERT INTO schema_migrations (filename, description)
VALUES (
    '069_vendor_compliance.sql',
    'product_reviews.vendor_response; vendors.payout_frozen; products.admin_restricted/restricted_reason; vendor_compliance_actions audit+notice table.'
)
ON CONFLICT (filename) DO NOTHING;
