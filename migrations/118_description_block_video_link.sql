-- 118_description_block_video_link.sql
-- Adds "video" and "link" description block types (Ryan, Sept 2026 - Channel
-- parity: rich content should support embedding a product video and a
-- plain link, same as the existing image/text/heading/grid blocks).
--
-- Reuses the existing image_url column as the block's URL rather than
-- adding new columns - it was already the generic "this block's media
-- lives here" slot for image blocks, and video/link blocks are the same
-- shape (one URL, plus optional/required text):
--   video: image_url = the video URL (YouTube/Vimeo link or a direct
--          .mp4 URL); body = optional caption shown under the player,
--          exactly like an image block's caption today.
--   link:  image_url = the link's target URL; body = the link's visible
--          label text (required - an unlabeled link renders nothing
--          useful on the storefront).

BEGIN;

ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS product_description_blocks_type_check;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT product_description_blocks_type_check
    CHECK (type IN ('image', 'text', 'heading', 'grid', 'video', 'link'));

-- A video's caption is optional (same as an image's), a grid has no
-- top-level body, but a link with no label text is meaningless.
ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS pdb_text_needs_body;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT pdb_text_needs_body
    CHECK (type IN ('image', 'grid', 'video') OR body IS NOT NULL);

-- Video and link blocks both need their URL, same as image blocks do.
ALTER TABLE product_description_blocks
    DROP CONSTRAINT IF EXISTS pdb_image_needs_url;

ALTER TABLE product_description_blocks
    ADD CONSTRAINT pdb_image_needs_url
    CHECK (type NOT IN ('image', 'video', 'link') OR image_url IS NOT NULL);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '118_description_block_video_link.sql',
    'product_description_blocks: adds video and link block types, reusing image_url as their URL column.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
