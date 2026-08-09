-- =====================================================================
-- Lizimas Store — migration 022
-- Region-first cascade
--
-- Form order:
--   Region  ->  District/City  ->  Division/Sub-county  ->  Parish/Area
--
-- Region is a filter, never an anchor. A region-only address cannot be
-- delivered, so addresses_check_level() still rejects level 1.
--
-- Run:  psql "$RENDER_DB" -f 022_region_cascade.sql
-- =====================================================================

BEGIN;

SET LOCAL client_min_messages TO WARNING;

-- ---------------------------------------------------------------------
-- One call per dropdown. Pass NULL for the first (regions).
-- Returns the unit name so the UI can label the next field correctly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION location_options(parent INTEGER DEFAULT NULL)
RETURNS TABLE (
  id         INTEGER,
  name       TEXT,
  level      SMALLINT,
  unit       TEXT,
  population INTEGER,
  has_children BOOLEAN
) AS $fn$
  SELECT l.id,
         l.name,
         l.level,
         CASE l.level WHEN 1 THEN 'Region'
                      WHEN 2 THEN 'District/City'
                      WHEN 3 THEN 'County'
                      WHEN 4 THEN 'Division/Sub-county'
                      WHEN 5 THEN 'Parish/Area' END,
         l.population,
         EXISTS (SELECT 1 FROM locations c WHERE c.parent_id = l.id AND c.is_active)
    FROM locations l
   WHERE l.is_active
     AND l.parent_id IS NOT DISTINCT FROM parent
   ORDER BY l.name;
$fn$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- The county problem.
--
-- UBOS puts County (3) between District and Division, but the form skips
-- it. So "divisions of a district" must reach through the county layer.
-- Verified safe: only 2 division names collide inside a district
-- nationally, both refugee settlements.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION divisions_of_district(district INTEGER)
RETURNS TABLE (id INTEGER, name TEXT, county_name TEXT, population INTEGER) AS $fn$
  SELECT l.id, l.name, c.name, l.population
    FROM locations l
    JOIN locations c ON c.id = l.county_id
   WHERE l.is_active AND l.level = 4 AND l.district_id = district
   ORDER BY l.name;
$fn$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION parishes_of_division(division INTEGER)
RETURNS TABLE (id INTEGER, name TEXT, population INTEGER) AS $fn$
  SELECT l.id, l.name, l.population
    FROM locations l
   WHERE l.is_active AND l.level = 5 AND l.parent_id = division
   ORDER BY l.name;
$fn$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Escape hatch: search all 147 districts regardless of region, and hand
-- back the region so the form can back-fill it. This is what saves the
-- customer who thinks Kiryandongo is Northern.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_district(q TEXT, lim INTEGER DEFAULT 10)
RETURNS TABLE (
  id          INTEGER,
  name        TEXT,
  region_id   INTEGER,
  region_name TEXT,
  population  INTEGER,
  score       REAL
) AS $fn$
  WITH needle AS (SELECT lower(unaccent(btrim(q))) AS n)
  SELECT l.id, l.name, r.id, r.name, l.population,
         (CASE WHEN l.name_search = nd.n            THEN 1.0
               WHEN l.name_search LIKE nd.n || '%'  THEN 0.8
               ELSE similarity(l.name_search, nd.n) * 0.6 END)::REAL
    FROM locations l
    JOIN locations r ON r.id = l.region_id
   CROSS JOIN needle nd
   WHERE l.is_active AND l.level = 2
     AND (l.name_search LIKE nd.n || '%' OR l.name_search % nd.n)
   ORDER BY 6 DESC, l.population DESC NULLS LAST
   LIMIT lim;
$fn$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Region stays out of the anchor set. Restated here so the rule lives
-- in one place regardless of which migration you last ran.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION addresses_check_level() RETURNS TRIGGER AS $fn$
DECLARE lv SMALLINT;
BEGIN
  SELECT level INTO lv FROM locations WHERE id = NEW.location_id AND is_active;
  IF lv IS NULL THEN
    RAISE EXCEPTION 'addresses: location % not found or inactive', NEW.location_id;
  END IF;
  IF lv = 1 THEN
    RAISE EXCEPTION 'addresses: a region is not a deliverable address';
  END IF;
  IF lv NOT IN (2, 4, 5) THEN
    RAISE EXCEPTION 'addresses: anchor must be a district, division or parish, got level %', lv;
  END IF;
  NEW.location_level := lv;

  IF lv < 5 AND COALESCE(btrim(NEW.area_text), '') = '' THEN
    RAISE EXCEPTION 'addresses: area_text is required when no parish/area is selected';
  END IF;
  IF lv = 5 THEN
    NEW.area_text := NULLIF(btrim(COALESCE(NEW.area_text, '')), '');
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Verification — walk the full cascade for the Ntinda example
-- ---------------------------------------------------------------------
SELECT name, unit FROM location_options(NULL);                    -- 4 regions
SELECT name FROM find_district('kampala', 3);
SELECT name, county_name FROM divisions_of_district(
  (SELECT id FROM locations WHERE level = 2 AND name = 'Kampala'));
SELECT name FROM parishes_of_division(
  (SELECT id FROM locations WHERE level = 4 AND name = 'Nakawa Division'
     AND district_id = (SELECT id FROM locations WHERE level = 2 AND name = 'Kampala')));

COMMIT;
