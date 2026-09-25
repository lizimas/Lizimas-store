-- 123_vendor_shop_setup.sql
-- Jumia-style "Let's take your shop live!" onboarding on the vendor mobile
-- Home screen (Ryan, Sept 2026). Adds the fields behind three of its five
-- steps that had nowhere to live yet:
--   * Shop Information - communication contact + customer-care details
--   * Company Information - legal representative's details + registered
--     (business) address (TIN/VAT already live on vendor_kyc, migration 122)
--   * Shipping Information - ship-from address + return address, each with
--     a "same as business address" flag
--   * Additional Information - Shop Details (existing shop? seller type)
--     and Catalog Details (primary category, sourcing, offline/other
--     online channels)
--
-- Contact/customer-care/shipping live in their own vendor_shop_profile
-- table (one row per vendor), not on vendors, so vendors stays the lean
-- approval/status row it is today. The legal representative block goes on
-- vendor_kyc because it is identity/verification data reviewed alongside
-- TIN/VAT/Form 20 and must stay admin-only like the rest of that table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_shop_profile (
    vendor_id                   INTEGER PRIMARY KEY REFERENCES public.vendors(id) ON DELETE CASCADE,

    -- Communication details
    contact_name                VARCHAR(200),
    contact_email               VARCHAR(255),
    contact_phone               VARCHAR(20),

    -- Customer care details
    cc_name                     VARCHAR(200),
    cc_phone                    VARCHAR(20),
    cc_email                    VARCHAR(255),
    cc_address_line1            VARCHAR(255),
    cc_address_line2            VARCHAR(255),
    cc_city                     VARCHAR(120),
    cc_region                   VARCHAR(120),
    cc_postal_code              VARCHAR(20),
    cc_country                  VARCHAR(60) NOT NULL DEFAULT 'Uganda',

    -- Shipping (ship-from) address
    ship_same_as_business       BOOLEAN NOT NULL DEFAULT false,
    ship_address_line1          VARCHAR(255),
    ship_address_line2          VARCHAR(255),
    ship_city                   VARCHAR(120),
    ship_region                 VARCHAR(120),
    ship_postal_code            VARCHAR(20),
    ship_country                VARCHAR(60) NOT NULL DEFAULT 'Uganda',

    -- Return address
    return_same_as_business     BOOLEAN NOT NULL DEFAULT false,
    return_address_line1        VARCHAR(255),
    return_address_line2        VARCHAR(255),
    return_city                 VARCHAR(120),
    return_region               VARCHAR(120),
    return_postal_code          VARCHAR(20),
    return_country              VARCHAR(60) NOT NULL DEFAULT 'Uganda',

    -- Additional Information > Shop Details
    has_existing_shop           BOOLEAN,
    seller_types                TEXT[],
    -- Additional Information > Catalog Details
    primary_category_id         INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
    sourcing_method             VARCHAR(30),
    sells_offline               BOOLEAN,
    uses_other_channels         BOOLEAN,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vendor_shop_profile IS
    'Vendor-editable shop setup details from the mobile Home onboarding (Shop, Shipping and Additional Information steps). See server/utils/vendorShopSetup.js for step-completion rules.';

ALTER TABLE vendor_kyc
    ADD COLUMN IF NOT EXISTS legal_rep_full_name     VARCHAR(200),
    ADD COLUMN IF NOT EXISTS legal_rep_id_types      TEXT[],
    ADD COLUMN IF NOT EXISTS business_address_line1  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_address_line2  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS business_city           VARCHAR(120),
    ADD COLUMN IF NOT EXISTS business_region         VARCHAR(120),
    ADD COLUMN IF NOT EXISTS business_postal_code    VARCHAR(20),
    ADD COLUMN IF NOT EXISTS business_country        VARCHAR(60) NOT NULL DEFAULT 'Uganda';

COMMENT ON COLUMN vendor_kyc.business_address_line1 IS
    'Legal representative''s / registered business address (Company Information step). Also the source for the Shipping step''s "same as your business address" toggles.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '123_vendor_shop_setup.sql',
    'Adds vendor_shop_profile (communication, customer care, shipping/return addresses, additional shop/catalog details) and legal representative + business address columns on vendor_kyc for the mobile Home shop-setup onboarding.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
