-- =====================================================================
-- Lizimas Store — migration 023
-- Bridge delivery_zones onto locations, and close the 19-district gap
--
-- Existing table is left structurally intact: district/zone/small_fee_ugx/
-- medium_fee_ugx/large_fee_ugx/eta all keep their meaning. One column is
-- added (location_id) so pricing stops depending on string matching.
--
-- Three groups are fixed:
--   A  3 spelling mismatches      -> repoint, no new rows
--   B  9 city authorities         -> inherit parent district fees exactly
--   C  7 unpriced + Apaa          -> neighbour district fees + 2,000 UGX
--
-- Run:  psql "$RENDER_DB" -v ON_ERROR_STOP=1 -f 023_zone_bridge.sql
-- =====================================================================

BEGIN;

SET LOCAL client_min_messages TO WARNING;

ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id);

-- ---------------------------------------------------------------------
-- Exact name matches (128 of 131)
-- ---------------------------------------------------------------------
UPDATE delivery_zones z
   SET location_id = l.id
  FROM locations l
 WHERE l.level = 2
   AND lower(l.name) = lower(z.district)
   AND z.location_id IS DISTINCT FROM l.id;

-- ---------------------------------------------------------------------
-- A. Spelling mismatches
-- ---------------------------------------------------------------------
UPDATE delivery_zones z SET location_id = l.id
  FROM locations l WHERE l.level = 2 AND l.name = 'Fort Portal City'
   AND lower(z.district) = 'fort portal';

UPDATE delivery_zones z SET location_id = l.id
  FROM locations l WHERE l.level = 2 AND l.name = 'Ssembabule'
   AND lower(z.district) = 'sembabule';

-- 'Kampala Capital' duplicates the 'Kampala' row, which is already linked.
-- Left unlinked deliberately rather than deleted — check it is unused in
-- your app, then drop it.
COMMENT ON TABLE delivery_zones IS
  'Priced per district. Row "Kampala Capital" is a legacy duplicate of "Kampala" and is intentionally unlinked; safe to delete once confirmed unused.';

-- ---------------------------------------------------------------------
-- B. City authorities inherit their parent district's pricing unchanged
-- ---------------------------------------------------------------------
INSERT INTO delivery_zones
       (district, zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta, location_id)
SELECT city.name, base.zone, base.small_fee_ugx, base.medium_fee_ugx,
       base.large_fee_ugx, base.eta, city.id
  FROM (VALUES
        ('Arua City','Arua'), ('Gulu City','Gulu'), ('Hoima City','Hoima'),
        ('Jinja City','Jinja'), ('Lira City','Lira'), ('Masaka City','Masaka'),
        ('Mbale City','Mbale'), ('Mbarara City','Mbarara'), ('Soroti City','Soroti')
       ) AS m(city_name, parent_name)
  JOIN locations city ON city.level = 2 AND city.name = m.city_name
  JOIN delivery_zones base ON lower(base.district) = lower(m.parent_name)
 WHERE NOT EXISTS (SELECT 1 FROM delivery_zones z WHERE z.location_id = city.id);

-- ---------------------------------------------------------------------
-- C. Unpriced districts: nearest priced neighbour + 2,000 UGX per tier
-- ---------------------------------------------------------------------
INSERT INTO delivery_zones
       (district, zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta, location_id)
SELECT tgt.name,
       base.zone,
       base.small_fee_ugx  + 2000,
       base.medium_fee_ugx + 2000,
       base.large_fee_ugx  + 2000,
       base.eta,
       tgt.id
  FROM (VALUES
        ('Amolatar',    'Dokolo'),      -- Lango, split from Dokolo/Apac
        ('Bukedea',     'Kumi'),        -- Teso, split from Kumi
        ('Bukwo',       'Kapchorwa'),   -- Elgon, split from Kapchorwa
        ('Kalaki',      'Kaberamaido'), -- split from Kaberamaido
        ('Kiboga',      'Mubende'),
        ('Kyankwanzi',  'Mubende'),     -- split from Kiboga, itself unpriced
        ('Madi-Okollo', 'Arua'),        -- split from Arua
        ('Apaa',        'Amuru')        -- contested; priced as Northern
       ) AS m(target_name, base_name)
  JOIN locations tgt ON tgt.level = 2 AND tgt.name = m.target_name
  JOIN delivery_zones base ON lower(base.district) = lower(m.base_name)
                          AND base.location_id IS NOT NULL
 WHERE NOT EXISTS (SELECT 1 FROM delivery_zones z WHERE z.location_id = tgt.id);

-- ---------------------------------------------------------------------
-- One priced row per district from here on
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS delivery_zones_location_uniq
  ON delivery_zones (location_id) WHERE location_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Price any address, at any anchor depth, by walking up to its district
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_delivery_zone(loc_id INTEGER)
RETURNS delivery_zones AS $fn$
  SELECT z.*
    FROM locations l
    JOIN delivery_zones z
      ON z.location_id = COALESCE(l.district_id, CASE WHEN l.level = 2 THEN l.id END)
   WHERE l.id = loc_id
   LIMIT 1;
$fn$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS districts_without_pricing
  FROM locations l
 WHERE l.level = 2
   AND NOT EXISTS (SELECT 1 FROM delivery_zones z WHERE z.location_id = l.id);
-- expected 0

SELECT district, zone, small_fee_ugx, eta
  FROM delivery_zones
 WHERE district IN ('Kiboga','Kyankwanzi','Apaa','Gulu City','Ssembabule')
 ORDER BY district;

SELECT district, small_fee_ugx FROM resolve_delivery_zone(
  (SELECT id FROM locations WHERE name = 'Ntinda' AND level = 5
     AND district_id = (SELECT id FROM locations WHERE level = 2 AND name = 'Kampala')));
-- expected: Kampala | 4000

SELECT COUNT(*) AS total_rows FROM delivery_zones;   -- expected 148

COMMIT;
