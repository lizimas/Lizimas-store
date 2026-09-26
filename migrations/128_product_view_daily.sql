-- 128_product_view_daily.sql
-- Product page views per day (Ryan, Sept 2026 - "Monitor your promotions"
-- Page Views column, parity). One row per product per UTC day,
-- bumped fire-and-forget by GET /api/products/:id (productController
-- getProductById). Views before this migration are simply not counted.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_view_daily (
    product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    day        DATE    NOT NULL,
    views      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, day)
);

COMMENT ON TABLE public.product_view_daily IS
    'Daily product page views (UTC day), counted by GET /api/products/:id. Used by the vendor Promotions > Monitoring page.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '128_product_view_daily.sql',
    'product_view_daily: per-product per-day page view counter for promotion monitoring.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
