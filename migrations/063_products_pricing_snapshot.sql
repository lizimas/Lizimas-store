-- 063_products_pricing_snapshot.sql
-- Records what the commission engine used to turn a vendor's desired payout
-- into products.price, so the vendor dashboard can show "your payout" next
-- to the customer price without recomputing it, and so a later change to a
-- commission rule doesn't retroactively change what an existing listing
-- claims it was priced under. Additive/nullable: staff-created products
-- (vendor_id IS NULL) never populate these and are completely unaffected -
-- products.price keeps meaning exactly what it always has, the
-- customer-facing price used by cart/checkout.

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS vendor_desired_payout    NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS commission_rate_applied  NUMERIC(6,4),
    ADD COLUMN IF NOT EXISTS fixed_fee_applied         NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS commission_rule_id         INTEGER REFERENCES commission_rules(id);

INSERT INTO schema_migrations (filename, note)
VALUES (
    '063_products_pricing_snapshot.sql',
    'products.vendor_desired_payout/commission_rate_applied/fixed_fee_applied/commission_rule_id - the commission-engine inputs/outputs behind a vendor product''s price, nullable and unused for staff-created products.'
)
ON CONFLICT (filename) DO NOTHING;
