-- 058_analytics_tracking.sql
-- Foundations for the admin Analytics / Performance Reports dashboards:
-- product views are already derivable from visitor_logs.page_visited
-- ("/product/<slug>-<id>"), but add-to-cart never had a server-side trace
-- (the cart itself lives entirely in localStorage). This adds that one
-- missing signal plus the indexes the new date-range queries lean on.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cart_events (
    id          SERIAL PRIMARY KEY,
    product_id  INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    ip_address  VARCHAR(64),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_events_product_id ON public.cart_events (product_id);
CREATE INDEX IF NOT EXISTS idx_cart_events_created_at ON public.cart_events (created_at);

-- Every analytics/report query filters visitor_logs by a date range, and the
-- per-product view count scans page_visited for the "/product/%" prefix.
CREATE INDEX IF NOT EXISTS idx_visitor_logs_visited_at
    ON public.visitor_logs (visited_at);

CREATE INDEX IF NOT EXISTS idx_visitor_logs_page_visited_pattern
    ON public.visitor_logs (page_visited text_pattern_ops);

COMMENT ON TABLE public.cart_events IS
    'One row per "add to cart" click, logged from cart.js addToCart(). Powers the admin analytics dashboard''s cart-add and conversion metrics; the cart itself stays client-side in localStorage.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '058_analytics_tracking.sql',
    'cart_events table for add-to-cart tracking, plus indexes on visitor_logs supporting the new analytics/performance-report date-range queries.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
