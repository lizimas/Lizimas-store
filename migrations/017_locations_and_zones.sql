-- =====================================================================
-- Lizimas Store — migration 017  (corrected)
-- Uganda administrative hierarchy
--
-- NOTE: this file deliberately does NOT touch delivery_zones. That table
-- already exists and prices 131 districts by name. Bridging it onto this
-- hierarchy happens in a later migration, once the districts are seeded
-- and the names can actually be matched.
--
-- Levels: 1 Region | 2 District/City | 3 County/Municipality
--         4 Sub-county/Division | 5 Parish/Ward
--
-- Run:  psql "$RENDER_DB" -v ON_ERROR_STOP=1 -f 017_locations_and_zones.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id              SERIAL PRIMARY KEY,
  parent_id       INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  level           SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 6),
  name            TEXT     NOT NULL,
  name_norm       TEXT     NOT NULL,
  ubos_code       TEXT,
  latitude        NUMERIC(9,6),
  longitude       NUMERIC(9,6),
  path            TEXT,
  label           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_user_added   BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at     TIMESTAMPTZ,
  merged_into_id  INTEGER REFERENCES locations(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS locations_parent_name_uniq
  ON locations (COALESCE(parent_id, 0), name_norm);

CREATE INDEX IF NOT EXISTS locations_parent_level_idx ON locations (parent_id, level)
  WHERE is_active;
CREATE INDEX IF NOT EXISTS locations_level_idx     ON locations (level) WHERE is_active;
CREATE INDEX IF NOT EXISTS locations_path_idx      ON locations (path text_pattern_ops);
CREATE INDEX IF NOT EXISTS locations_name_trgm_idx ON locations USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS locations_pending_idx   ON locations (created_at)
  WHERE is_user_added AND approved_at IS NULL;

-- ---------------------------------------------------------------------
-- Maintain name_norm / path / label automatically
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION locations_fill() RETURNS TRIGGER AS $fn$
DECLARE
  p      RECORD;
  g_name TEXT;
BEGIN
  NEW.name      := btrim(regexp_replace(NEW.name, '\s+', ' ', 'g'));
  NEW.name_norm := lower(unaccent(NEW.name));

  IF NEW.parent_id IS NULL THEN
    IF NEW.level <> 1 THEN
      RAISE EXCEPTION 'locations: only level 1 (region) may have no parent';
    END IF;
    NEW.path  := '/';
    NEW.label := NEW.name;
  ELSE
    SELECT id, path, name, level, parent_id INTO p
      FROM locations WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'locations: parent % does not exist', NEW.parent_id;
    END IF;
    IF p.level <> NEW.level - 1 THEN
      RAISE EXCEPTION 'locations: a level-% row cannot sit under a level-% row',
        NEW.level, p.level;
    END IF;

    NEW.path := p.path || p.id || '/';

    SELECT name INTO g_name FROM locations WHERE id = p.parent_id;
    NEW.label := NEW.name || ', ' || p.name || COALESCE(', ' || g_name, '');
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS locations_fill_trg ON locations;
CREATE TRIGGER locations_fill_trg
  BEFORE INSERT OR UPDATE OF name, parent_id ON locations
  FOR EACH ROW EXECUTE FUNCTION locations_fill();

-- ---------------------------------------------------------------------
-- Order snapshot columns. delivery_zone_id points at the EXISTING
-- delivery_zones table; only the snapshot text is new.
-- ---------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_location_id   INTEGER REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS delivery_location_path TEXT,
  ADD COLUMN IF NOT EXISTS delivery_zone_id       INTEGER REFERENCES delivery_zones(id),
  ADD COLUMN IF NOT EXISTS delivery_zone_name     TEXT;

CREATE INDEX IF NOT EXISTS orders_delivery_location_idx ON orders (delivery_location_id);

-- ---------------------------------------------------------------------
-- Seed level 1 only
-- ---------------------------------------------------------------------
INSERT INTO locations (parent_id, level, name)
VALUES (NULL, 1, 'Central'), (NULL, 1, 'Eastern'),
       (NULL, 1, 'Northern'), (NULL, 1, 'Western')
ON CONFLICT DO NOTHING;

SELECT level, COUNT(*) FROM locations GROUP BY level ORDER BY level;

COMMIT;
