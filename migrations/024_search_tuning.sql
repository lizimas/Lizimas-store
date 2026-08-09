-- =====================================================================
-- Lizimas Store — migration 024
-- Tighten search_locations()
--
-- Problem: 'ntinda' returned Nanda, Ntiba, Katinda. The % operator uses
-- pg_trgm's default 0.3 threshold, which is far too loose for short place
-- names, and SET pg_trgm.similarity_threshold does not survive connection
-- pooling — so the rule has to live inside the function.
--
-- Fix, two parts:
--   1. Fuzzy matching now needs similarity >= 0.45, not 0.3.
--   2. Fuzzy results only appear at all when prefix and alias matching
--      returned fewer than 3 rows. If 'ntinda' finds Ntinda, nobody needs
--      to see Nanda. Typos still work: 'ntida' finds nothing by prefix,
--      so the fuzzy pass runs and catches it.
--
-- Signature is unchanged, so locationController.js needs no edit.
--
-- Run:  psql "$RENDER_DB" -v ON_ERROR_STOP=1 -f 024_search_tuning.sql
-- =====================================================================

BEGIN;

SET LOCAL client_min_messages TO WARNING;

DROP FUNCTION IF EXISTS search_locations(TEXT, INTEGER, INTEGER, SMALLINT, SMALLINT);

CREATE FUNCTION search_locations(
  q          TEXT,
  lim        INTEGER  DEFAULT 15,
  within     INTEGER  DEFAULT NULL,
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
  WITH needle AS (
    SELECT lower(unaccent(btrim(q))) AS n
  ),
  scope AS (
    SELECT path || id || '/' AS pfx FROM locations WHERE id = within
  ),
  -- Exact and prefix matches on the canonical or suffix-stripped name
  prefix_hits AS (
    SELECT l.id AS loc_id, NULL::TEXT AS alias,
           CASE WHEN l.name_norm = nd.n OR l.name_search = nd.n THEN 1.0
                WHEN l.name_search LIKE nd.n || '%'             THEN 0.8
                ELSE 0.7 END::REAL AS score
      FROM locations l CROSS JOIN needle nd
     WHERE l.is_active
       AND l.level BETWEEN min_level AND max_level
       AND (l.name_norm LIKE nd.n || '%' OR l.name_search LIKE nd.n || '%')
  ),
  alias_hits AS (
    SELECT a.location_id, a.alias,
           CASE WHEN a.alias_norm = nd.n THEN 1.0 ELSE 0.85 END::REAL
      FROM location_aliases a CROSS JOIN needle nd
     WHERE a.alias_norm LIKE nd.n || '%'
  ),
  solid AS (
    SELECT * FROM prefix_hits
    UNION ALL
    SELECT * FROM alias_hits
  ),
  -- Only consulted when the solid pass came up thin
  fuzzy_hits AS (
    SELECT l.id, NULL::TEXT,
           (similarity(l.name_search, nd.n) * 0.6)::REAL
      FROM locations l CROSS JOIN needle nd
     WHERE (SELECT COUNT(*) FROM solid) < 3
       AND l.is_active
       AND l.level BETWEEN min_level AND max_level
       AND similarity(l.name_search, nd.n) >= 0.45
  ),
  best AS (
    SELECT DISTINCT ON (loc_id) loc_id, alias, score
      FROM (SELECT * FROM solid UNION ALL SELECT * FROM fuzzy_hits) AS all_hits
     ORDER BY loc_id, score DESC
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
SELECT name, unit, district_name FROM search_locations('ntinda', 10);
-- expected: Ntinda first, no Nanda / Ntiba / Katinda

SELECT name, unit, district_name FROM search_locations('ntida', 5);
-- typo with no prefix match — fuzzy pass should still find Ntinda

SELECT name, unit, district_name FROM search_locations('kireka', 5);
SELECT name, unit, district_name FROM search_locations('bukoto', 5);

COMMIT;
