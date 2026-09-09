-- Order-time commission locking (flagged gap from the commission-engine
-- slice, now closed).
--
-- Until now, every vendor earnings figure (dashboard summary, wallet
-- balance) was computed by joining order_items back to products and using
-- that product's CURRENT commission_rate_applied/fixed_fee_applied - not
-- what applied at the moment the order was actually placed. That means an
-- old, already-delivered order's numbers could silently shift later if a
-- vendor edited their price (which recomputes the product's commission
-- snapshot) or if a category's commission rule changed - exactly the
-- retroactive-distortion risk the versioned commission_rules table
-- (migration 061) existed to prevent, but nothing was copying its values
-- onto an order until now.
--
-- These three columns mirror products.commission_rate_applied/
-- fixed_fee_applied/commission_rule_id (migration 063) but on the specific
-- order_item, snapshotted once at checkout and never touched again.
-- Nullable/additive: an order placed before this migration simply has
-- NULLs here, and the reporting code falls back to the product's current
-- snapshot for those - the same approximation used everywhere until now,
-- so historical numbers do not change.

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS commission_rate_applied  NUMERIC(6,4),
    ADD COLUMN IF NOT EXISTS fixed_fee_applied         NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS commission_rule_id         INTEGER REFERENCES commission_rules(id);

INSERT INTO schema_migrations (filename, note)
VALUES (
    '072_order_item_commission_lock.sql',
    'order_items.commission_rate_applied/fixed_fee_applied/commission_rule_id - snapshots the commission that applied at checkout, so later rate or product-price changes never retroactively change an already-placed order''s numbers.'
)
ON CONFLICT (filename) DO NOTHING;
