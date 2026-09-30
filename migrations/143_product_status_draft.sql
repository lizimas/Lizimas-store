-- 143_product_status_draft.sql
-- "Save as Draft" (Sept 2026) failed on the live database with
--   new row for relation "products" violates check constraint "products_status_check"
-- The live products table has a status check that was added outside the
-- migrations and does not list 'draft' (nor, possibly, the review statuses
-- from 141). This replaces it with one that allows every product status the
-- app uses:
--   draft, pending, approved, rejected, changes_requested, under_investigation
-- Any other status already stored on a row is kept in the list too, so no
-- existing product can make this fail.

BEGIN;

DO $$
DECLARE
    allowed TEXT;
BEGIN
    SELECT string_agg(quote_literal(s), ', ' ORDER BY s) INTO allowed
      FROM (
            SELECT unnest(ARRAY['draft', 'pending', 'approved', 'rejected',
                                'changes_requested', 'under_investigation']) AS s
            UNION
            SELECT DISTINCT status FROM public.products WHERE status IS NOT NULL
           ) all_statuses;

    ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_check;
    EXECUTE 'ALTER TABLE public.products ADD CONSTRAINT products_status_check CHECK (status IN (' || allowed || '))';
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('143_product_status_draft.sql', 'products.status check allows draft, changes_requested and under_investigation (Save as Draft failed on live).')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
