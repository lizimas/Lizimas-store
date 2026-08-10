-- ---------------------------------------------------------------------
-- 024_drop_legacy_kampala_capital.sql
--
-- 023 bridged delivery_zones to locations and deliberately left the
-- legacy 'Kampala Capital' row unlinked, noting it was safe to delete
-- once confirmed unused. That confirmation is done: no order references
-- the string and no code path passes it.
--
-- With it gone, every pricing row carries a location_id, so the check
-- constraint below stops another orphan appearing. An unlinked row is
-- invisible to resolve_delivery_zone() -- it joins on location_id -- so
-- it would sit in the table looking like valid pricing while never
-- being reachable.
-- ---------------------------------------------------------------------

BEGIN;

-- Guarded: only removes the row if it is still the unlinked duplicate.
DELETE FROM delivery_zones
 WHERE district = 'Kampala Capital'
   AND location_id IS NULL;

-- Fails loudly if any other unlinked row exists, rather than silently
-- leaving unreachable pricing behind.
ALTER TABLE delivery_zones
  ADD CONSTRAINT delivery_zones_location_required
  CHECK (location_id IS NOT NULL);

COMMIT;

-- ---------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS unlinked_zone_rows
  FROM delivery_zones
 WHERE location_id IS NULL;
-- expected 0

SELECT COUNT(*) AS districts_without_pricing
  FROM locations l
 WHERE l.level = 2
   AND NOT EXISTS (SELECT 1 FROM delivery_zones z WHERE z.location_id = l.id);
-- expected 0

SELECT COUNT(*) AS zone_rows FROM delivery_zones;
