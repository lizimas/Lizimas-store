-- 036_description_block_grid.sql
-- Adds a multi-column "grid" description block (Lulu Section Type D).
--
-- The per-column items live in a JSONB payload rather than a child table:
-- they are always written and read as a single unit, are inherently ordered,
-- and are never queried individually, so a join buys nothing.
--
-- payload shape for type = 'grid':
-- {
--   "heading": "Flexi Jar with 3 Lids",
--   "columns": 3,
--   "items": [
--     {
--       "image_url":    "https://res.cloudinary.com/.../lid-dome.jpg",
--       "image_width":  600,
--       "image_height": 600,
--       "alt_text":     "Dome lid",
--       "caption":      "Dome Lid",
--       "body":         "Locks in steam while blending hot liquids."
--     }
--   ]
-- }

BEGIN;

ALTER TABLE product_description_blocks
    ADD COLUMN IF NOT EXISTS payload JSONB;

-- Allow the new type.
ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS product_description_blocks_type_check;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT product_description_blocks_type_check
    CHECK (type IN ('image', 'text', 'heading', 'grid'));

-- A grid row carries no top-level body, so it must be exempt from the
-- existing "everything that isn't an image needs body" rule.
ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS pdb_text_needs_body;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT pdb_text_needs_body
    CHECK (type IN ('image', 'grid') OR body IS NOT NULL);

-- Conversely, a grid row is meaningless without at least one item.
ALTER TABLE product_description_blocks
    ADD CONSTRAINT pdb_grid_needs_items
    CHECK (
        type <> 'grid'
        OR (
            payload IS NOT NULL
            AND jsonb_typeof(payload -> 'items') = 'array'
            AND jsonb_array_length(payload -> 'items') > 0
        )
    );

COMMIT;
