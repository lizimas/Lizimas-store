-- 108_product_quality_score.sql
-- Per-listing Quality/Content Score + duplicate-listing detection (Channel
-- Vendor Center comparison, September 2026). Channel shows a content-quality
-- indicator on every listing (image count, description length, identifiers
-- filled in) and flags likely duplicate submissions during upload - this
-- migration adds the columns that back both.
--
-- quality_score/quality_score_breakdown are computed and cached at
-- add/update time by server/utils/productQuality.js (not a DB trigger -
-- keeps the scoring rubric easy to tune without a migration each time).
-- possible_duplicate_of is set the same way, from a pg_trgm name-similarity
-- check against the vendor's own other listings in the same category - it
-- is advisory (surfaced to the vendor and in the admin product queue),
-- never a submission blocker, since a false positive would stop a
-- legitimate listing.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS quality_score SMALLINT,
  ADD COLUMN IF NOT EXISTS quality_score_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS possible_duplicate_of INTEGER REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_possible_duplicate_of ON products (possible_duplicate_of) WHERE possible_duplicate_of IS NOT NULL;

COMMENT ON COLUMN products.quality_score IS
    'Listing completeness score, 0-100, computed by server/utils/productQuality.js at add/update time - images, description length, title quality, brand/GTIN/MPN, and category attributes filled in. Not a moderation signal; purely a "how complete is this listing" indicator shown to the vendor (and visible to admin/staff).';
COMMENT ON COLUMN products.quality_score_breakdown IS
    'JSON {score, maxScore, tips: [{label, points, earned}]} snapshot behind quality_score, so the vendor sees exactly what to fix.';
COMMENT ON COLUMN products.possible_duplicate_of IS
    'Set when this listing''s name is a close pg_trgm match (>=0.55) to another of the SAME vendor''s own listings in the same category. Advisory only - never blocks a submission. Cleared automatically if the vendor edits the name away from the match on their next save.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '108_product_quality_score.sql',
    'Per-listing Quality/Content Score (products.quality_score/quality_score_breakdown) and advisory duplicate-listing detection (products.possible_duplicate_of, pg_trgm name similarity) - see server/utils/productQuality.js.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
