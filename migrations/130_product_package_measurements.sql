-- 130_product_package_measurements.sql
-- Automatic delivery tier (Ryan, Sept 2026): vendors, staff and admin no
-- longer pick "Package Size (delivery tier)" - they enter the packed
-- weight and dimensions, and products.package_size (which still drives
-- delivery pricing in server/utils/deliveryPricing.js) is calculated from
-- them by client/js/lz-package-size.js. Existing products keep their
-- current package_size until someone adds measurements.

BEGIN;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(8,3),
    ADD COLUMN IF NOT EXISTS length_cm NUMERIC(7,1),
    ADD COLUMN IF NOT EXISTS width_cm  NUMERIC(7,1),
    ADD COLUMN IF NOT EXISTS height_cm NUMERIC(7,1);

COMMENT ON COLUMN products.weight_kg IS 'Packed weight in kg - with length/width/height_cm it sets package_size automatically (client/js/lz-package-size.js).';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '130_product_package_measurements.sql',
    'products.weight_kg/length_cm/width_cm/height_cm: package_size (delivery tier) now calculated from measurements.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
