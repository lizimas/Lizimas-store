-- 132_product_percent_discounts.sql
-- Admin "Discount Promotions" (Ryan, Sept 2026).
-- An admin puts a PERCENT discount on one or many products. Only the percent
-- is stored - never a sale price - so the sale price is always worked out
-- from the product's current price: if a 30% product goes from 500,000 to
-- 700,000 it stays 30% off (490,000). The admin may type the price they want
-- customers to pay instead; the server turns that into the percent here
-- (kept to 6 decimal places so the typed price comes back exactly).
-- One active discount per product; saving a new one replaces the old one.

BEGIN;

CREATE TABLE IF NOT EXISTS product_discounts (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    percent     NUMERIC(9,6) NOT NULL CHECK (percent > 0 AND percent < 100),
    starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at     TIMESTAMPTZ,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    label       VARCHAR(120),
    created_by  INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS product_discounts_one_active
    ON product_discounts (product_id) WHERE is_active;

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '132_product_percent_discounts.sql',
    'product_discounts: admin percent discounts, price computed live from products.price.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
