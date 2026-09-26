-- 109_vendor_product_tiers.sql
-- Product-count limit tiers (September
-- 2026 - Channel caps how many active listings a seller can carry, rising
-- with a GMV-based tier as they grow, roughly Tier A through G). This adds
-- an admin-configurable tier ladder plus a per-vendor manual override.
--
-- vendor_product_tiers is the ladder itself - admin CRUD via
-- adminProductTierController.js. tier_code is the primary key (a short
-- code like 'tier_1') rather than a SERIAL id so vendors.product_tier_override
-- can reference it directly and stay human-readable in the DB.
--
-- A vendor's EFFECTIVE tier (server/utils/vendorProductTier.js) is:
--   product_tier_override, if set (admin manually placed them there) -
--   otherwise the highest tier whose min_gmv_90d is at or below the
--   vendor's own trailing-90-day delivered GMV, computed on demand exactly
--   like sellerScore.js (no caching/background job - see that file's
--   header for why this project keeps doing it that way).
--
-- Seed thresholds/caps below are starting points, same spirit as the
-- default 15% commission rate and sellerScore.js's weights (see
-- PENDING.md): tune from the new admin screen once there's real GMV data
-- to judge them against, not by editing this migration again.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_product_tiers (
    tier_code             VARCHAR(20) PRIMARY KEY,
    tier_name             VARCHAR(50) NOT NULL,
    min_gmv_90d           NUMERIC(14,2) NOT NULL DEFAULT 0,
    max_active_products   INTEGER,  -- NULL = unlimited
    sort_order            SMALLINT NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendors
    ADD COLUMN IF NOT EXISTS product_tier_override VARCHAR(20) REFERENCES public.vendor_product_tiers(tier_code) ON DELETE SET NULL;

INSERT INTO public.vendor_product_tiers (tier_code, tier_name, min_gmv_90d, max_active_products, sort_order) VALUES
    ('tier_1', 'New Seller', 0,          50,   1),
    ('tier_2', 'Bronze',     500000,     150,  2),
    ('tier_3', 'Silver',     2000000,    500,  3),
    ('tier_4', 'Gold',       8000000,    2000, 4),
    ('tier_5', 'Platinum',   25000000,   NULL, 5)
ON CONFLICT (tier_code) DO NOTHING;

COMMENT ON TABLE public.vendor_product_tiers IS
    'Admin-configurable GMV tier ladder capping how many active listings a vendor may carry (). Managed from the admin Settings screen, not hand-edited - see adminProductTierController.js.';
COMMENT ON COLUMN public.vendor_product_tiers.min_gmv_90d IS
    'Trailing 90-day delivered GMV (UGX) a vendor needs to QUALIFY for this tier. A vendor''s effective tier is the highest one they qualify for, unless product_tier_override is set.';
COMMENT ON COLUMN public.vendor_product_tiers.max_active_products IS
    'Cap on this vendor''s total non-deleted listings (pending + approved + rejected + inactive all count, matching how Channel counts a seller''s catalogue size, not just live ones). NULL = unlimited.';
COMMENT ON COLUMN public.vendors.product_tier_override IS
    'Admin manual override of this vendor''s tier (e.g. a trusted new seller fast-tracked, or a seller capped early for a quality issue). NULL means "use the GMV ladder normally" - see server/utils/vendorProductTier.js.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '109_vendor_product_tiers.sql',
    'Product-count limit tiers: vendor_product_tiers (admin-configurable GMV ladder) + vendors.product_tier_override (manual override) - see server/utils/vendorProductTier.js.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
