-- =====================================================================
-- Lizimas Store — migration 020
-- UBOS-canonical addressing
--
-- Decision: locations holds exactly what UBOS publishes, nothing else.
--   * The delivery anchor is a PARISH / WARD (level 5). Full stop.
--   * No user-generated location rows, so no duplicate entities.
--   * Village / locality becomes free text on the address, like landmark.
--
-- The problem this creates: UBOS names are administrative, not colloquial.
-- 'Kireka Ward', 'Bukoto I', 'Bweyogerere Ward'. Customers type 'kireka'.
-- Solved with one canonical row + many search keys:
--   name_search      — suffix-stripped, derived automatically
--   location_aliases — colloquial names UBOS does not carry at all
--
-- Run:  psql "$RENDER_DB" -f 020_ubos_canonical.sql
-- =====================================================================

BEGIN;

SET LOCAL client_min_messages TO WARNING;

-- ---------------------------------------------------------------------
-- Derived search name
-- ---------------------------------------------------------------------
ALTER TABLE locations ADD COLUMN IF NOT EXISTS name_search TEXT;

CREATE OR REPLACE FUNCTION location_search_name(raw TEXT) RETURNS TEXT AS $fn$
DECLARE s TEXT;
BEGIN
  s := lower(unaccent(btrim(raw)));
  -- administrative suffixes
  s := regexp_replace(s, '\s+(sub[- ]?county|town council|city council|municipal council|division|ward|parish|county|municipality|city)$', '', 'g');
  s := regexp_replace(s, '\s+(sc|tc)\s+ward$', '', 'g');
  s := regexp_replace(s, '\s+(sc|tc)$', '', 'g');
  -- trailing enumerators: 'Bukoto II', 'Bwaise III', 'Kisenyi I'
  s := regexp_replace(s, '\s+(i{1,3}|iv|v|vi{1,3}|ix|x)$', '', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  RETURN NULLIF(s, '');
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------
-- Fill trigger, third revision: now also maintains name_search
-- ---------------------------------------------------------------------
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
    NEW.path := '/'; NEW.district_id := NULL; NEW.label := NEW.name;
  ELSE
    SELECT id, path, name, level, district_id INTO p
      FROM locations WHERE id = NEW.parent_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'locations: parent % does not exist', NEW.parent_id;
    END IF;
    IF p.level <> NEW.level - 1 THEN
      RAISE EXCEPTION 'locations: a level-% row cannot sit under a level-% row',
        NEW.level, p.level;
    END IF;

    NEW.path        := p.path || p.id || '/';
    NEW.district_id := CASE WHEN NEW.level = 2 THEN NULL
                            ELSE COALESCE(p.district_id, p.id) END;

    parts := ARRAY[NEW.name];
    IF NEW.level >= 4 AND p.name <> NEW.name THEN parts := parts || p.name; END IF;
    IF NEW.district_id IS NOT NULL THEN
      SELECT name INTO d_name FROM locations WHERE id = NEW.district_id;
      IF d_name IS NOT NULL AND NOT (d_name = ANY (parts)) THEN
        parts := parts || d_name;
      END IF;
    END IF;
    NEW.label := array_to_string(parts, ', ');
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- Backfill name_search across everything already seeded.
UPDATE locations SET name_search = COALESCE(location_search_name(name), name_norm);

CREATE INDEX IF NOT EXISTS locations_name_search_trgm
  ON locations USING gin (name_search gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Aliases — colloquial names with no UBOS row of their own.
-- Naalya, Kisaasi, Najjera, Nalya and friends live here, each pointing
-- at the parish that actually contains them. Populate with local
-- knowledge; do NOT guess.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_aliases (
  id          SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  alias       TEXT    NOT NULL,
  alias_norm  TEXT    NOT NULL,
  note        TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS location_aliases_uniq
  ON location_aliases (alias_norm, location_id);
CREATE INDEX IF NOT EXISTS location_aliases_norm_trgm
  ON location_aliases USING gin (alias_norm gin_trgm_ops);

CREATE OR REPLACE FUNCTION location_aliases_norm() RETURNS TRIGGER AS $fn$
BEGIN
  NEW.alias      := btrim(regexp_replace(NEW.alias, '\s+', ' ', 'g'));
  NEW.alias_norm := lower(unaccent(NEW.alias));
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS location_aliases_norm_trg ON location_aliases;
CREATE TRIGGER location_aliases_norm_trg
  BEFORE INSERT OR UPDATE ON location_aliases
  FOR EACH ROW EXECUTE FUNCTION location_aliases_norm();

-- ---------------------------------------------------------------------
-- Search misses — the queue that tells you which aliases to add.
-- Same idea as search_logs, for locations.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_search_misses (
  id          SERIAL PRIMARY KEY,
  query       TEXT NOT NULL,
  query_norm  TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS location_misses_norm_idx
  ON location_search_misses (query_norm) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------
-- Search: canonical name, derived name, and alias — deduped to one row
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS search_locations(TEXT, INTEGER);
CREATE FUNCTION search_locations(q TEXT, lim INTEGER DEFAULT 15)
RETURNS TABLE (
  id            INTEGER,
  name          TEXT,
  label         TEXT,
  level         SMALLINT,
  district_name TEXT,
  matched_alias TEXT,
  score         REAL
) AS $fn$
  WITH needle AS (
    SELECT lower(unaccent(btrim(q))) AS n
  ),
  hits AS (
    SELECT l.id AS loc_id,
           NULL::TEXT AS alias,
           CASE WHEN l.name_norm = nd.n OR l.name_search = nd.n THEN 1.0
                WHEN l.name_search LIKE nd.n || '%'             THEN 0.8
                WHEN l.name_norm   LIKE nd.n || '%'             THEN 0.7
                ELSE similarity(l.name_search, nd.n) * 0.6 END::REAL AS score
      FROM locations l CROSS JOIN needle nd
     WHERE l.is_active
       AND l.level = 5
       AND (l.name_norm LIKE nd.n || '%'
         OR l.name_search LIKE nd.n || '%'
         OR l.name_search % nd.n)
    UNION ALL
    SELECT a.location_id,
           a.alias,
           CASE WHEN a.alias_norm = nd.n THEN 1.0 ELSE 0.85 END::REAL
      FROM location_aliases a CROSS JOIN needle nd
     WHERE a.alias_norm LIKE nd.n || '%' OR a.alias_norm % nd.n
  ),
  best AS (
    SELECT DISTINCT ON (loc_id) loc_id, alias, score
      FROM hits ORDER BY loc_id, score DESC
  )
  SELECT l.id, l.name, l.label, l.level, d.name, b.alias, b.score
    FROM best b
    JOIN locations l ON l.id = b.loc_id AND l.is_active
    JOIN locations d ON d.id = l.district_id
   ORDER BY b.score DESC, l.population DESC NULLS LAST, l.name
   LIMIT lim;
$fn$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Addresses: anchor is a parish, exactly. Village is free text.
-- ---------------------------------------------------------------------
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS village TEXT;
ALTER TABLE orders    ADD COLUMN IF NOT EXISTS delivery_village TEXT;

CREATE OR REPLACE FUNCTION addresses_check_level() RETURNS TRIGGER AS $fn$
DECLARE lv SMALLINT;
BEGIN
  SELECT level INTO lv FROM locations WHERE id = NEW.location_id AND is_active;
  IF lv IS NULL THEN
    RAISE EXCEPTION 'addresses: location % not found or inactive', NEW.location_id;
  END IF;
  IF lv <> 5 THEN
    RAISE EXCEPTION 'addresses: anchor must be a parish/ward (level 5), got level %', lv;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- Block any non-UBOS row from being created.
CREATE OR REPLACE FUNCTION locations_no_level6() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'locations: level 6 is not used — village is free text on the address';
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS locations_no_level6_trg ON locations;
CREATE TRIGGER locations_no_level6_trg
  BEFORE INSERT ON locations
  FOR EACH ROW WHEN (NEW.level = 6)
  EXECUTE FUNCTION locations_no_level6();

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT 'kireka' AS typed, id, name, label FROM search_locations('kireka', 3);
SELECT 'bukoto' AS typed, id, name, label FROM search_locations('bukoto', 3);
SELECT 'ntinda' AS typed, id, name, label FROM search_locations('ntinda', 3);
SELECT COUNT(*) AS parishes_missing_search_name
  FROM locations WHERE level = 5 AND name_search IS NULL;   -- expected 0

COMMIT;
