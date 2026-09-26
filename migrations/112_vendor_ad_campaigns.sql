-- 112_vendor_ad_campaigns.sql
-- Advertise Your Products (September 2026):
-- vendor-funded, cost-per-click sponsored placements for their own
-- products "Advertise Your Products" tab and the
-- vc_advertising_manager permission code reserved for it since migration
-- 107. A vendor creates a campaign (products + budget), submits it for
-- admin review, and admin approves/rejects it - the same request/approve
-- shape as vendor promotions (see vendor_promotions).
--
-- Scope note: this migration and its controllers build the full campaign
-- management control plane (vendor create/submit/pause, admin review,
-- platform-wide CPC/budget settings) plus a working tracking API
-- (impressions/clicks decrement budget_spent and auto-pause at
-- exhaustion). Actually INJECTING sponsored product slots into the public
-- storefront's search/category/listing pages is a deliberately flagged,
-- NOT-built follow-up - a storefront-rendering change, not a Vendor
-- Center one. GET /api/ads/sponsored-products exists and is ready for the
-- storefront to call whenever that follow-up happens.

BEGIN;

-- Singleton row: platform-wide ad defaults/bounds, admin-controlled (see
-- adminAdController.js's getAdSettings/updateAdSettings). Sellers see the
-- resulting cpc_rate on their own campaigns (it's a cost-per-click ad rate,
-- not the commission % - the "sellers never see commission" rule from
-- Sept 2026 does not apply here).
CREATE TABLE IF NOT EXISTS public.ad_platform_settings (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    default_cpc_rate    NUMERIC(10,2) NOT NULL DEFAULT 500.00,
    min_daily_budget    NUMERIC(12,2) NOT NULL DEFAULT 5000.00,
    max_daily_budget    NUMERIC(12,2) NOT NULL DEFAULT 500000.00,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.ad_platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.vendor_ad_campaigns (
    id              SERIAL PRIMARY KEY,
    vendor_id       INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'pending_review', 'active', 'paused', 'rejected', 'completed', 'budget_exhausted')),
    cpc_rate        NUMERIC(10,2) NOT NULL,
    daily_budget    NUMERIC(12,2) NOT NULL,
    total_budget    NUMERIC(12,2) NOT NULL,
    budget_spent    NUMERIC(12,2) NOT NULL DEFAULT 0,
    start_date      DATE,
    end_date        DATE,
    admin_notes     TEXT,
    reviewed_by     INTEGER REFERENCES public.users(id),
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_ad_campaigns_vendor ON public.vendor_ad_campaigns (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_ad_campaigns_status ON public.vendor_ad_campaigns (status);

CREATE TABLE IF NOT EXISTS public.vendor_ad_campaign_products (
    id              SERIAL PRIMARY KEY,
    campaign_id     INTEGER NOT NULL REFERENCES public.vendor_ad_campaigns(id) ON DELETE CASCADE,
    product_id      INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    impressions     INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (campaign_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_ad_campaign_products_campaign ON public.vendor_ad_campaign_products (campaign_id);
CREATE INDEX IF NOT EXISTS idx_vendor_ad_campaign_products_product ON public.vendor_ad_campaign_products (product_id);

COMMENT ON TABLE public.vendor_ad_campaigns IS
    'Vendor-funded cost-per-click ad campaigns (Advertise Your Products / ). draft -> pending_review (vendor submits) -> active (admin approves) or rejected. A vendor can pause/resume an active campaign themselves; budget_exhausted is set automatically when budget_spent reaches total_budget.';
COMMENT ON COLUMN public.vendor_ad_campaigns.cpc_rate IS
    'Snapshot of ad_platform_settings.default_cpc_rate at submission time, so a later platform-wide rate change never retroactively changes a running campaign''s economics.';
COMMENT ON TABLE public.vendor_ad_campaign_products IS
    'Which of the vendor''s own products are promoted by a campaign, with per-product impression/click counters logged via POST /api/ads/track.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '112_vendor_ad_campaigns.sql',
    'Advertise Your Products: vendor_ad_campaigns + vendor_ad_campaign_products (CPC ad campaign management, vendor create/submit/pause + admin review), ad_platform_settings (admin-controlled default CPC rate and budget bounds). Storefront ad-slot injection deliberately not built - see file header.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
