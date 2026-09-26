-- 135_migration_ledger_cleanup.sql
-- Tidies the migration ledger (Ryan, Sept 2026). The live database had an
-- extra ledger row, 065_add_is_active_to_products.sql, from a one-off fix
-- that was never in the repository; the column it added (products.is_active)
-- is created by 072_products_active_flags.sql, which is in the repo. The
-- repository's own 065 is 065_vendor_order_stage.sql.
--
-- This removes the stray row, and records 065_vendor_order_stage.sql /
-- 072_products_active_flags.sql as applied when what they create already
-- exists (so a full "run all pending" never tries them again). Nothing in
-- the schema itself changes.

BEGIN;

DELETE FROM public.schema_migrations
 WHERE filename = '065_add_is_active_to_products.sql';

INSERT INTO public.schema_migrations (filename, note)
SELECT '065_vendor_order_stage.sql', 'Recorded by 135: order_items.vendor_fulfilment_stage already present.'
 WHERE EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'vendor_fulfilment_stage')
ON CONFLICT (filename) DO NOTHING;

INSERT INTO public.schema_migrations (filename, note)
SELECT '072_products_active_flags.sql', 'Recorded by 135: products.is_active already present.'
 WHERE EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'is_active')
ON CONFLICT (filename) DO NOTHING;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('135_migration_ledger_cleanup.sql', 'Removed the stray 065_add_is_active_to_products.sql ledger row.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
