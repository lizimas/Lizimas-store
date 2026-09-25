-- 125_description_block_table.sql
-- Adds the "table" description block type (Ryan, Sept 2026 - fully
-- functional insert-table: header row/column, insert/delete rows and
-- columns, merge/split cells). The table itself lives in the existing
-- payload JSONB column (validated by client/js/lz-table.js's normalize(),
-- shared by editor, server and storefront); body keeps a plain-text copy,
-- so the existing "every non-media block needs a body" rule still holds.
--
-- Re-states 118's type list (video, link) as well: run 118 BEFORE this one
-- if it is still pending, or 118 would drop 'table' again.

BEGIN;

ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS product_description_blocks_type_check;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT product_description_blocks_type_check
    CHECK (type IN ('image', 'text', 'heading', 'grid', 'video', 'link', 'table'));

ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS pdb_table_needs_payload;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT pdb_table_needs_payload
    CHECK (type <> 'table' OR (payload IS NOT NULL AND jsonb_typeof(payload -> 'cells') = 'array'));

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '125_description_block_table.sql',
    'product_description_blocks: adds the table block type (payload = rows/cols/header flags/anchor cells with rowspan/colspan).'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
