-- 124_promotion_campaigns.sql
-- Lizimas-run promotion campaigns vendors can join (Ryan, Sept 2026 -
-- Jumia Vendor Center "Promotions Management" parity: e.g. "PAYWEEK DEALS",
-- "BLACK FRIDAY - PHONES & TABLETS").
--
-- Admin creates a campaign with a registration deadline, a live period and
-- an optional min/max discount band. Vendors join by nominating products
-- and a sale price inside that band. Each nomination is an ordinary
-- vendor_promotions row (status 'pending', window = the campaign period,
-- campaign_id set), so the EXISTING admin review, checkout price
-- enforcement, product-page discount display and homepage-feature flow
-- all apply unchanged - no second pricing path.
--
-- Campaign status (open / idle / ongoing / expired / cancelled) is derived
-- from the dates + is_cancelled at read time - see
-- server/utils/promotionCampaigns.js - never stored.

BEGIN;

CREATE TABLE IF NOT EXISTS public.promotion_campaigns (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(160) NOT NULL,
    description             TEXT,
    registration_ends_at    TIMESTAMPTZ NOT NULL,
    starts_at               TIMESTAMPTZ NOT NULL,
    ends_at                 TIMESTAMPTZ NOT NULL,
    min_discount_pct        NUMERIC(5,2) CHECK (min_discount_pct IS NULL OR (min_discount_pct > 0 AND min_discount_pct < 100)),
    max_discount_pct        NUMERIC(5,2) CHECK (max_discount_pct IS NULL OR (max_discount_pct > 0 AND max_discount_pct < 100)),
    is_cancelled            BOOLEAN NOT NULL DEFAULT false,
    cancelled_at            TIMESTAMPTZ,
    created_by              INTEGER REFERENCES public.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT promotion_campaigns_window_check CHECK (ends_at > starts_at),
    CONSTRAINT promotion_campaigns_registration_check CHECK (registration_ends_at <= starts_at),
    CONSTRAINT promotion_campaigns_band_check CHECK (
        min_discount_pct IS NULL OR max_discount_pct IS NULL OR min_discount_pct <= max_discount_pct
    )
);

CREATE INDEX IF NOT EXISTS idx_promotion_campaigns_ends ON public.promotion_campaigns (ends_at DESC);

COMMENT ON TABLE public.promotion_campaigns IS
    'Admin-run promotion campaigns vendors join by nominating products (vendor_promotions.campaign_id). Status derived in server/utils/promotionCampaigns.js.';

ALTER TABLE public.vendor_promotions
    ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES public.promotion_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_promotions_campaign
    ON public.vendor_promotions (campaign_id, vendor_id) WHERE campaign_id IS NOT NULL;

COMMENT ON COLUMN public.vendor_promotions.campaign_id IS
    'Set when this promotion is a vendor''s entry into a Lizimas promotion campaign; NULL for a standalone vendor-proposed promotion.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '124_promotion_campaigns.sql',
    'promotion_campaigns (admin-run campaigns with registration deadline, period, discount band) + vendor_promotions.campaign_id for vendor campaign entries.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
