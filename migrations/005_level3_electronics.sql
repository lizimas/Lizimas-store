-- 005: Three-level support and Electronics level-3 categories
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
--
-- Name uniqueness moved from global to per-parent: with three levels,
-- names like "Accessories" or "Cables" legitimately repeat under different parents.

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_parent_key
  ON categories (name, COALESCE(parent_id, 0));

-- Level-3 under Electronics. Parent ids are local values.
INSERT INTO categories (name, parent_id, display_order) VALUES
  ('Smartphones', 15, 1), ('Feature Phones', 15, 2), ('Smartwatches', 15, 3),
  ('Phone Cases & Covers', 15, 4), ('Screen Protectors', 15, 5),
  ('Chargers & Cables', 15, 6), ('Power Banks', 15, 7),
  ('Smart TVs', 16, 1), ('LED TVs', 16, 2), ('TV Mounts & Stands', 16, 3),
  ('TV Accessories', 16, 4),
  ('Headphones', 17, 1), ('Earbuds', 17, 2), ('Bluetooth Speakers', 17, 3),
  ('Home Theatre & Soundbars', 17, 4), ('Radios', 17, 5),
  ('Laptops', 18, 1), ('Desktops', 18, 2), ('Monitors', 18, 3),
  ('Printers & Scanners', 18, 4), ('Keyboards & Mice', 18, 5), ('Laptop Bags', 18, 6),
  ('Consoles', 19, 1), ('Games', 19, 2), ('Controllers', 19, 3),
  ('Gaming Accessories', 19, 4),
  ('Storage & Flash Drives', 20, 1), ('Cables & Adapters', 20, 2),
  ('Routers & Networking', 20, 3), ('UPS & Surge Protectors', 20, 4),
  ('Webcams & Microphones', 20, 5)
ON CONFLICT DO NOTHING;
