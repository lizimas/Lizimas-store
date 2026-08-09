-- =====================================================================
-- Lizimas Store — migration 021
-- Two-concept addressing: full UBOS hierarchy underneath, short form on top
--
-- Underneath (locations, untouched, UBOS-canonical):
--   1 Region  2 District/City  3 County/Municipality
--   4 Sub-county/Division      5 Parish/Ward
--
-- On the form (addresses):
--   District/City   [picked, required]        -> level 2
--   Division        [picked, recommended]     -> level 4
--   Area            [picked, optional]        -> level 5
--   Village/Locality, Street/Road, Building/House, Landmark, Phone [text]
--
-- Region and County never appear on the form. Verified against the 2024
-- census: county names are unique inside a district (0 collisions of 312)
-- and parish names are unique inside a division (0 collisions of 10,854),
-- so both are derivable from the deepest pick.
--
-- The address stores ONE location_id — whatever depth the customer got to
-- — plus its level. Everything shallower is derived, never stored twice.
--
-- Run:  psql "$RENDER_DB" -f 021_address_form.sql
-- =====================================================================

BEGIN;

SET LOCAL client_min_messages TO WARNING;

-- ---------------------------------------------------------------------
-- Denormalised ancestry, so a parish knows its division/district/region
-- without a recursive walk
-- ---------------------------------------------------------------------
ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS region_id    INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS county_id    INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS subcounty_id INTEGER REFERENCES locations(id);

CREATE OR REPLACE FUNCTION locations_fill() RETURNS TRIGGER AS $fn$
DECLARE
  p      RECORD;
  d_name TEXT;
  parts  TEXT[];
BEGIN
  NEW.name        := btrim(regexp_replace(NEW.name, '\s+', ' ', 'g'));
  NEW.name_norm   := lower(unaccent(NEW.name));
  NEW.name_search := COALESCE(location_search_name(NEW.name), NEW.name_norm);

  IF NEW.parent_id IS NULL THEN
    IF NEW.level <> 1 THEN
      RAISE EXCEPTION 'locations: only level 1 (region) may have no parent';
    END IF;
    NEW.path  := '/';
    NEW.label := NEW.name;
    NEW.region_id := NULL; NEW.district_id := NULL;
    NEW.county_id := NULL; NEW.subcounty_id := NULL;
  ELSE
    SELECT id, path, name, level, region_id, district_id, county_id, subcounty_id
      INTO p FROM locations WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'locations: parent % does not exist', NEW.parent_id;
    END IF;
    IF p.level <> NEW.level - 1 THEN
      RAISE EXCEPTION 'locations: a level-% row cannot sit under a level-% row',
        NEW.level, p.level;
    END IF;

    NEW.path := p.path || p.id || '/';

    NEW.region_id    := CASE WHEN NEW.level <= 1 THEN NULL
                        ELSE COALESCE(p.region_id,    CASE WHEN p.level = 1 THEN p.id END) END;
    NEW.district_id  := CASE WHEN NEW.level <= 2 THEN NULL
                        ELSE COALESCE(p.district_id,  CASE WHEN p.level = 2 THEN p.id END) END;
    NEW.county_id    := CASE WHEN NEW.level <= 3 THEN NULL
                        ELSE COALESCE(p.county_id,    CASE WHEN p.level = 3 THEN p.id END) END;
    NEW.subcounty_id := CASE WHEN NEW.level <= 4 THEN NULL
                        ELSE COALESCE(p.subcounty_id, CASE WHEN p.level = 4 THEN p.id END) END;

    parts := ARRAY[NEW.name];
    IF NEW.level >= 4 AND p.name <> NEW.name THEN parts := parts || p.name; END IF;
    IF NEW.district_id IS NOT NULL THEN
      SELECT name INTO d_name FROM locations WHERE id = NEW.district_id;
      IF d_name IS NOT NULL AND NOT (d_name = ANY (parts)) THEN parts := parts || d_name; END IF;
    END IF;
    NEW.label := array_to_string(parts, ', ');
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- Backfill, shallowest first so each level sees its parent already filled.
DO $bf$
DECLARE lv SMALLINT;
BEGIN
  FOR lv IN 1..5 LOOP
    UPDATE locations SET name = name WHERE level = lv;
  END LOOP;
END;
$bf$;

CREATE INDEX IF NOT EXISTS locations_subcounty_idx ON locations (subcounty_id, level) WHERE is_active;

-- ---------------------------------------------------------------------
-- One row per place with every ancestor name spelled out.
-- This is what the checkout autofills from after a single pick.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW location_full AS
SELECT l.id,
       l.level,
       l.name,
       r.name  AS region_name,
       d.name  AS district_name,
       c.name  AS county_name,
       s.name  AS subcounty_name,
       CASE WHEN l.level = 5 THEN l.name END AS parish_name,
       l.label,
       l.population,
       l.latitude,
       l.longitude
  FROM locations l
  LEFT JOIN locations r ON r.id = COALESCE(l.region_id,    CASE WHEN l.level = 1 THEN l.id END)
  LEFT JOIN locations d ON d.id = COALESCE(l.district_id,  CASE WHEN l.level = 2 THEN l.id END)
  LEFT JOIN locations c ON c.id = COALESCE(l.county_id,    CASE WHEN l.level = 3 THEN l.id END)
  LEFT JOIN locations s ON s.id = COALESCE(l.subcounty_id, CASE WHEN l.level = 4 THEN l.id END)
 WHERE l.is_active;

-- ---------------------------------------------------------------------
-- Addresses: variable-depth anchor
-- ---------------------------------------------------------------------
ALTER TABLE addresses
  ADD COLUMN IF NOT EXISTS country_code   CHAR(2) NOT NULL DEFAULT 'UG',
  ADD COLUMN IF NOT EXISTS location_level SMALLINT,
  ADD COLUMN IF NOT EXISTS area_text      TEXT;   -- typed when no parish was picked

COMMENT ON COLUMN addresses.location_id IS
  'Deepest UBOS unit the customer selected: district (2), division (4) or parish (5).';
COMMENT ON COLUMN addresses.area_text IS
  'Free-text area, used only when location_level < 5. Never a substitute for location_id.';

-- Anchor may now be district, division or parish. County (3) is never
-- offered on the form, so it is not a valid anchor.
CREATE OR REPLACE FUNCTION addresses_check_level() RETURNS TRIGGER AS $fn$
DECLARE lv SMALLINT;
BEGIN
  SELECT level INTO lv FROM locations WHERE id = NEW.location_id AND is_active;
  IF lv IS NULL THEN
    RAISE EXCEPTION 'addresses: location % not found or inactive', NEW.location_id;
  END IF;
  IF lv NOT IN (2, 4, 5) THEN
    RAISE EXCEPTION 'addresses: anchor must be a district, division or parish, got level %', lv;
  END IF;
  NEW.location_level := lv;

  -- Below parish precision, a written area is the only thing standing in
  -- for it, so require something the rider can read.
  IF lv < 5 AND COALESCE(btrim(NEW.area_text), '') = '' THEN
    RAISE EXCEPTION 'addresses: area_text is required when no parish is selected';
  END IF;
  IF lv = 5 THEN
    NEW.area_text := NULLIF(btrim(COALESCE(NEW.area_text, '')), '');
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Zones need to know how vague an anchor they will accept
-- ---------------------------------------------------------------------
ALTER TABLE delivery_zones
  ADD COLUMN IF NOT EXISTS min_location_level SMALLINT NOT NULL DEFAULT 4;

COMMENT ON COLUMN delivery_zones.min_location_level IS
  'Refuse to price this zone from an anchor shallower than this. 4 = division.';

-- ---------------------------------------------------------------------
-- Fully resolved address, form fields and rider line in one row
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW addresses_full AS
SELECT a.id,
       a.user_id,
       a.label,
       a.recipient_name,
       a.phone,
       a.phone_alt,
       a.country_code,
       lf.region_name,
       lf.district_name,
       lf.subcounty_name                    AS division_name,
       COALESCE(lf.parish_name, a.area_text) AS area,
       a.village,
       a.street,
       a.building,
       a.landmark,
       a.instructions,
       a.location_id,
       a.location_level,
       COALESCE(a.latitude,  lf.latitude)   AS latitude,
       COALESCE(a.longitude, lf.longitude)  AS longitude,
       a.is_default,
       -- single line for the rider, empty parts dropped
       array_to_string(ARRAY(SELECT x FROM unnest(ARRAY[
         a.building, a.street, a.village,
         COALESCE(lf.parish_name, a.area_text),
         lf.subcounty_name, lf.district_name
       ]) AS x WHERE COALESCE(btrim(x), '') <> ''), ', ')
       || COALESCE(' — ' || NULLIF(btrim(a.landmark), ''), '') AS rider_line,
       a.created_at,
       a.updated_at
  FROM addresses a
  JOIN location_full lf ON lf.id = a.location_id
 WHERE NOT a.is_archived;

-- ---------------------------------------------------------------------
-- Search now returns divisions as well as parishes, so a customer who
-- only knows 'Nakawa' can stop there.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS search_locations(TEXT, INTEGER);
CREATE FUNCTION search_locations(
  q          TEXT,
  lim        INTEGER DEFAULT 15,
  within     INTEGER DEFAULT NULL,   -- restrict to descendants of this id
  min_level  SMALLINT DEFAULT 4,
  max_level  SMALLINT DEFAULT 5
)
RETURNS TABLE (
  id            INTEGER,
  name          TEXT,
  level         SMALLINT,
  unit          TEXT,
  district_name TEXT,
  division_name TEXT,
  matched_alias TEXT,
  score         REAL
) AS $fn$
  WITH needle AS (SELECT lower(unaccent(btrim(q))) AS n),
  scope AS (SELECT path || id || '/' AS pfx FROM locations WHERE id = within),
  hits AS (
    SELECT l.id AS loc_id, NULL::TEXT AS alias,
           CASE WHEN l.name_norm = nd.n OR l.name_search = nd.n THEN 1.0
                WHEN l.name_search LIKE nd.n || '%'             THEN 0.8
                WHEN l.name_norm   LIKE nd.n || '%'             THEN 0.7
                ELSE similarity(l.name_search, nd.n) * 0.6 END::REAL AS score
      FROM locations l CROSS JOIN needle nd
     WHERE l.is_active AND l.level BETWEEN min_level AND max_level
       AND (l.name_norm LIKE nd.n || '%' OR l.name_search LIKE nd.n || '%'
            OR l.name_search % nd.n)
    UNION ALL
    SELECT a.location_id, a.alias,
           CASE WHEN a.alias_norm = nd.n THEN 1.0 ELSE 0.85 END::REAL
      FROM location_aliases a CROSS JOIN needle nd
     WHERE a.alias_norm LIKE nd.n || '%' OR a.alias_norm % nd.n
  ),
  best AS (
    SELECT DISTINCT ON (loc_id) loc_id, alias, score
      FROM hits ORDER BY loc_id, score DESC
  )
  SELECT lf.id, lf.name, lf.level,
         CASE lf.level WHEN 4 THEN 'Division' WHEN 5 THEN 'Area' ELSE 'District' END,
         lf.district_name, lf.subcounty_name, b.alias, b.score
    FROM best b
    JOIN location_full lf ON lf.id = b.loc_id
    LEFT JOIN locations l ON l.id = b.loc_id
   WHERE within IS NULL
      OR l.path LIKE (SELECT pfx FROM scope) || '%'
      OR l.id = within
   ORDER BY b.score DESC, lf.population DESC NULLS LAST, lf.name
   LIMIT lim;
$fn$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT region_name, district_name, county_name, subcounty_name, parish_name
  FROM location_full WHERE id = (SELECT id FROM locations
    WHERE name = 'Ntinda' AND level = 5 LIMIT 1);
-- expected: Central | Kampala | Nakawa Division | Nakawa Division | Ntinda

SELECT name, unit, district_name FROM search_locations('nakawa', 5);
SELECT COUNT(*) AS unfilled FROM locations WHERE level = 5 AND subcounty_id IS NULL;
-- expected 0

COMMIT;
