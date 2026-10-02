-- 150_sku_suffix_no_hyphen.sql
-- The fixed vendor SKU suffix is joined straight on (TV-55AULZMS), not
-- with a hyphen (TV-55A-ULZMS). This tidies the SKUs saved with the hyphen.
-- A SKU is left alone if the tidied one is already used by another product.

BEGIN;

UPDATE public.products p
   SET sku = regexp_replace(p.sku, '-+ULZMS$', 'ULZMS')
 WHERE p.sku ~ '-+ULZMS$'
   AND NOT EXISTS (
        SELECT 1 FROM public.products o
         WHERE o.id <> p.id AND o.sku = regexp_replace(p.sku, '-+ULZMS$', 'ULZMS'));

INSERT INTO public.schema_migrations (filename, note)
VALUES ('150_sku_suffix_no_hyphen.sql', 'Vendor SKU suffix ULZMS without the hyphen.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
