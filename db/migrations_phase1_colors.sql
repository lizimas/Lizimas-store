BEGIN;

-- 1. Catalog gains swatch + common flag
ALTER TABLE color_catalog
    ADD COLUMN IF NOT EXISTS hex_code VARCHAR(7),
    ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 2. Normalised uniqueness: 'Black', 'black', ' BLACK ' collide
CREATE UNIQUE INDEX IF NOT EXISTS color_catalog_name_norm_idx
    ON color_catalog (LOWER(TRIM(name)));

-- 3. product_colors gains the FK, nullable for now (name stays)
ALTER TABLE product_colors
    ADD COLUMN IF NOT EXISTS color_id INTEGER REFERENCES color_catalog(id) ON DELETE RESTRICT;

-- 4. Backfill color_id by normalised name match
UPDATE product_colors pc
SET color_id = cc.id
FROM color_catalog cc
WHERE LOWER(TRIM(pc.name)) = LOWER(TRIM(cc.name))
  AND pc.color_id IS NULL;

-- 5. Mark the everyday colours
UPDATE color_catalog SET is_common = true
WHERE LOWER(TRIM(name)) IN ('black','white','grey','silver','blue','navy','red','green','yellow','orange','pink','purple','brown','beige','gold');

COMMIT;
