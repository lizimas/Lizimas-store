BEGIN;

-- Nominatim takes ~5s per lookup and rate-limits aggressively, so results are
-- cached by coordinate. Rounding to 4 decimal places (~11m) means nearby pins
-- in the same compound share a cache entry.
CREATE TABLE IF NOT EXISTS geocode_cache (
  lat_key      NUMERIC(9,4) NOT NULL,
  lng_key      NUMERIC(9,4) NOT NULL,
  display_name TEXT,
  address      JSONB,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lat_key, lng_key)
);

COMMIT;
