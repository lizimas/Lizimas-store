-- 078_category_commission_rates.sql
-- Real per-category commission rates (Task #72, Ryan Sept 2026). Benchmarked
-- against Jumia Uganda's 2025 rate card, then adjusted into Lizimas' actual
-- launch rates for the categories that exist in Lizimas' live catalog.
--
-- commission_rules is resolved by walking UP the category tree from a
-- product's own category (server/utils/commissionEngine.js) - own category,
-- then its parent, then grandparent, ... then the NULL marketplace-wide
-- default. That means one rule on a branch category covers every leaf
-- beneath it that has no more specific rule of its own, and a leaf-level
-- rule always wins over anything set higher up. This migration uses both:
-- branch-level rules where a whole subtree shares one rate, and leaf-level
-- overrides where a subtree needs to be split (e.g. phones vs. phone
-- accessories under "Mobiles & Gadgets") or where a specific product type
-- needs to break away from its parent's rate (baby items).
--
-- What is intentionally NOT covered by this migration, and why:
--   - Cameras, Tablets, Beauty Appliances (distinct from Health & Beauty),
--     Sporting Goods, Musical Instruments, Auto & Moto, and Luggage & Travel
--     Gear do not exist as categories anywhere in Lizimas' live catalog
--     (confirmed against a fetch of GET /api/products/categories in
--     production - 230 categories, none matching). There is no category_id
--     to attach a rate to. They fall through to the 15% marketplace default
--     automatically and get their own rate the moment a matching category is
--     created - Ryan's call ("15% default until category exists").
--   - Smartwatches (a leaf under Mobiles & Gadgets) wasn't part of Ryan's
--     rate card either; left uncovered, so it inherits Mobiles & Gadgets'
--     un-set rate and falls through to the 15% default the same way.
-- See PENDING.md for the full category-by-category mapping writeup.

BEGIN;

INSERT INTO public.commission_rules (category_id, commission_rate, fixed_processing_fee, tax_rate, commission_tax_included, status)
SELECT v.category_id, v.commission_rate, 0, 0, true, 'active'
FROM (
    VALUES
        -- Mobile Phones (6%) vs. Electronics Accessories (17%) - split out
        -- of the "Mobiles & Gadgets" branch, which otherwise has no rule of
        -- its own so anything not listed here (e.g. smartwatches) falls
        -- through to the 15% default.
        (86,  0.06),  -- Smartphones
        (87,  0.06),  -- Feature Phones
        (89,  0.17),  -- Phone Cases & Covers
        (90,  0.17),  -- Screen Protectors
        (91,  0.17),  -- Chargers & Cables
        (92,  0.17),  -- Power Banks

        -- Laptops, Desktops & Monitors (10%) vs. Electronics Accessories
        -- (17%) - split out of "Computers & Accessories".
        (102, 0.10),  -- Laptops
        (103, 0.10),  -- Desktops
        (104, 0.10),  -- Monitors
        (105, 0.17),  -- Printers & Scanners
        (106, 0.17),  -- Keyboards & Mice
        (107, 0.17),  -- Laptop Bags

        -- Electronics Accessories (17%) - whole branch, no split needed.
        (16,  0.17),  -- IT Accessories (branch: cables, routers, storage, UPS, webcams)

        -- Televisions (8%) vs. Electronics Accessories (17%) - split out
        -- of "TV".
        (93,  0.08),  -- Smart TVs
        (94,  0.08),  -- LED TVs
        (226, 0.08),  -- UHD LED TVs
        (95,  0.17),  -- TV Mounts & Stands
        (96,  0.17),  -- TV Accessories

        -- Gaming and Sounds & Audio weren't in Ryan's rate card - explicit
        -- rows at the marketplace default (15%) for a clear, auditable
        -- record rather than silently relying on the fallback.
        (15,  0.15),  -- Gaming (branch)
        (13,  0.15),  -- Sounds & Audio (branch)

        -- Small Appliances (7%) - "Home Appliances" and "Kitchen Appliances"
        -- both benchmark to Small Appliances (countertop/portable items,
        -- not the Large Appliances below).
        (28,  0.07),  -- Home Appliances (branch: fans, irons, sewing machines, vacuums, water dispensers)
        (27,  0.07),  -- Kitchen Appliances (branch: blenders, kettles, microwaves, rice cookers, etc.)

        -- Large Appliances (10%).
        (29,  0.10),  -- Major Appliances (branch: cookers, gas cylinders, fridges, washing machines)

        -- Home (12%) - furniture, décor, cooking/dining ware, outdoor
        -- furniture all benchmark to the general "Home" bucket.
        (31,  0.12),  -- Home Furniture (branch)
        (33,  0.12),  -- Décor (branch)
        (30,  0.12),  -- Cooking & Dining (branch)
        (32,  0.12),  -- Outdoor Furniture (branch)

        -- Fashion & Sportswear (12% both) - one rule covers the whole
        -- "Apparel & Boutique" top-level branch (clothing, sunglasses,
        -- bags & accessories, sportswear all share this rate).
        (2,   0.12),  -- Apparel & Boutique (top-level branch)

        -- Grocery & Health & Beauty (15%, same as the marketplace default)
        -- - explicit row on "Supermarket" for a clear, auditable record
        -- matching Ryan's rate card, even though it numerically matches the
        -- fallback. Toys is carved out below since it differs.
        (1,   0.15),  -- Supermarket (top-level branch: groceries, personal care, etc.)

        -- Toys & Games (10%) - carved out of Supermarket's 15%.
        (21,  0.10),  -- Toys (branch)

        -- Baby Products (15%) - scattered across unrelated branches with no
        -- single category to unify under, so each specific baby-related
        -- leaf that would otherwise inherit a different rate from its
        -- parent gets an explicit override back to 15%. Baby Care (under
        -- Personal Care) and Baby's Food & Milk (under Groceries) already
        -- land on 15% via Supermarket's rate above, so only these two need
        -- an explicit break from their parent's rate:
        (119, 0.15),  -- Baby Clothing (otherwise inherits Apparel & Boutique's 12%)
        (85,  0.15),  -- Baby & Toddler Toys (otherwise inherits Toys' 10%)

        -- Not in Ryan's rate card - explicit rows at the marketplace
        -- default (15%) for a clear, auditable record.
        (9,   0.15),  -- Books & Stationery (top-level branch)
        (4,   0.15)   -- Cleaning & Essentials (top-level branch)
) AS v(category_id, commission_rate)
WHERE NOT EXISTS (
    SELECT 1 FROM public.commission_rules cr
    WHERE cr.category_id = v.category_id AND cr.status = 'active'
);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '078_category_commission_rates.sql',
    'Seeds real per-category commission_rules rates (Task #72) for every category Ryan''s Jumia-benchmarked rate card maps to - branch-level rules where a subtree shares one rate, leaf-level overrides for phones-vs-accessories, TVs-vs-accessories, computers-vs-accessories splits, and the scattered baby-product leaves. Categories with no match in Lizimas'' live catalog (Cameras, Tablets, Beauty Appliances, Sporting Goods, Musical Instruments, Auto & Moto, Luggage & Travel Gear) are left uncovered and fall through to the 15% marketplace default.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
