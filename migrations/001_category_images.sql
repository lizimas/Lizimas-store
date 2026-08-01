-- 001: Category tile images and soft-delete
-- Applied local: 2026-08-01
-- Applied Render: 2026-08-01

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE categories SET display_order = id WHERE display_order = 0;

ALTER TABLE categories ADD CONSTRAINT categories_name_key UNIQUE (name);
