-- =====================================================================
-- Lizimas Store — migration 019
-- Delivery addresses
--
-- Model:
--   locations  = WHERE it is, formally. Validated, seeded from UBOS.
--                Region > District > Sub-county > Parish > Village.
--   addresses  = HOW the rider finds it. Free text, unvalidatable,
--                anchored to one locations row at parish level or below.
--
-- Run:  psql "$RENDER_DB" -f 019_addresses.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- addresses
-- user_id NULL = guest checkout address (kept for the order, not reusable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS addresses (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT,                 -- 'Home', 'Office', 'Mum's place'

  recipient_name  TEXT NOT NULL,
  phone           TEXT NOT NULL,        -- E.164, e.g. +256701234567
  phone_alt       TEXT,

  -- Administrative anchor. Must be level 5 (parish/ward) or 6 (village).
  location_id     INTEGER NOT NULL REFERENCES locations(id),

  -- Rider-facing detail. All optional except landmark.
  street          TEXT,                 -- 'Bukoto Street', 'Plot 12 Kyadondo Rd'
  building        TEXT,                 -- 'Kensington Apts, Block B, Flat 4'
  landmark        TEXT NOT NULL,        -- 'opposite Total Ntinda, blue gate'
  instructions    TEXT,                 -- 'call on arrival, gate closes 8pm'

  -- Optional dropped pin. Falls back to the parish centroid when absent.
  latitude        NUMERIC(9,6),
  longitude       NUMERIC(9,6),
  pin_source      TEXT CHECK (pin_source IN ('user_pin','geocode','centroid')),

  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT addresses_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT addresses_phone_alt_e164 CHECK (phone_alt IS NULL OR phone_alt ~ '^\+[1-9][0-9]{6,14}$')
);

CREATE INDEX IF NOT EXISTS addresses_user_idx     ON addresses (user_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS addresses_location_idx ON addresses (location_id);

-- Exactly one default per user.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default
  ON addresses (user_id) WHERE is_default AND NOT is_archived AND user_id IS NOT NULL;

-- The anchor must be specific enough to price a delivery.
CREATE OR REPLACE FUNCTION addresses_check_level() RETURNS TRIGGER AS $fn$
DECLARE lv SMALLINT;
BEGIN
  SELECT level INTO lv FROM locations WHERE id = NEW.location_id AND is_active;
  IF lv IS NULL THEN
    RAISE EXCEPTION 'addresses: location % not found or inactive', NEW.location_id;
  END IF;
  IF lv < 5 THEN
    RAISE EXCEPTION 'addresses: anchor must be a parish or village, got level %', lv;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS addresses_check_level_trg ON addresses;
CREATE TRIGGER addresses_check_level_trg
  BEFORE INSERT OR UPDATE ON addresses
  FOR EACH ROW EXECUTE FUNCTION addresses_check_level();

-- Setting a new default clears the old one.
CREATE OR REPLACE FUNCTION addresses_single_default() RETURNS TRIGGER AS $fn$
BEGIN
  IF NEW.is_default AND NEW.user_id IS NOT NULL THEN
    UPDATE addresses SET is_default = FALSE
     WHERE user_id = NEW.user_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS addresses_single_default_trg ON addresses;
CREATE TRIGGER addresses_single_default_trg
  AFTER INSERT OR UPDATE OF is_default ON addresses
  FOR EACH ROW WHEN (NEW.is_default)
  EXECUTE FUNCTION addresses_single_default();

-- ---------------------------------------------------------------------
-- Order snapshot. An address can be edited or deleted after an order
-- ships; the order must not change with it.
-- ---------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS address_id             INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_recipient     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_phone         TEXT,
  ADD COLUMN IF NOT EXISTS delivery_phone_alt     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_street        TEXT,
  ADD COLUMN IF NOT EXISTS delivery_building      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_landmark      TEXT,
  ADD COLUMN IF NOT EXISTS delivery_instructions  TEXT,
  ADD COLUMN IF NOT EXISTS delivery_latitude      NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS delivery_longitude     NUMERIC(9,6);

-- ---------------------------------------------------------------------
-- One-box location search. Powers the checkout picker:
--   'ntind' -> Ntinda, Nakawa Division, Kampala
-- Searches sub-county level and below only; nobody types 'Central Region'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_locations(q TEXT, lim INTEGER DEFAULT 15)
RETURNS TABLE (
  id            INTEGER,
  name          TEXT,
  label         TEXT,
  level         SMALLINT,
  district_name TEXT,
  population    INTEGER
) AS $fn$
  WITH needle AS (SELECT lower(unaccent(btrim(q))) AS n)
  SELECT l.id, l.name, l.label, l.level, d.name, l.population
    FROM locations l
    JOIN locations d ON d.id = l.district_id
   CROSS JOIN needle
   WHERE l.is_active
     AND l.level >= 4
     AND (l.approved_at IS NOT NULL OR NOT l.is_user_added)
     AND l.merged_into_id IS NULL
     AND (l.name_norm LIKE needle.n || '%' OR l.name_norm % needle.n)
   ORDER BY (l.name_norm = needle.n) DESC,
            (l.name_norm LIKE needle.n || '%') DESC,
            similarity(l.name_norm, needle.n) DESC,
            l.population DESC NULLS LAST
   LIMIT lim;
$fn$ LANGUAGE sql STABLE;

-- Children of a node, for the browse/cascade fallback.
CREATE OR REPLACE FUNCTION location_children(parent INTEGER)
RETURNS TABLE (id INTEGER, name TEXT, level SMALLINT) AS $fn$
  SELECT l.id, l.name, l.level
    FROM locations l
   WHERE l.parent_id = parent
     AND l.is_active
     AND l.merged_into_id IS NULL
     AND (l.approved_at IS NOT NULL OR NOT l.is_user_added)
   ORDER BY l.name;
$fn$ LANGUAGE sql STABLE;

COMMIT;
