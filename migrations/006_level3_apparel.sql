-- 006: Level-3 categories under Apparel & Boutique
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
-- Parent ids are local values.

INSERT INTO categories (name, parent_id, display_order) VALUES
  ('Boys'' Clothing', 21, 1), ('Girls'' Clothing', 21, 2), ('Baby Clothing', 21, 3),
  ('School Wear', 21, 4), ('Children''s Shoes', 21, 5),
  ('Dresses', 22, 1), ('Tops & Blouses', 22, 2), ('Skirts & Trousers', 22, 3),
  ('Gomesi & Traditional Wear', 22, 4), ('Kitenge & African Print', 22, 5),
  ('Underwear & Lingerie', 22, 6), ('Women''s Shoes', 22, 7),
  ('Shirts', 23, 1), ('T-Shirts & Polos', 23, 2), ('Trousers & Jeans', 23, 3),
  ('Suits & Blazers', 23, 4), ('Kanzu & Traditional Wear', 23, 5),
  ('Underwear & Socks', 23, 6), ('Men''s Shoes', 23, 7),
  ('Men''s Sunglasses', 24, 1), ('Women''s Sunglasses', 24, 2), ('Reading Glasses', 24, 3),
  ('Jerseys & Team Kits', 25, 1), ('Tracksuits', 25, 2), ('Sports Shoes', 25, 3),
  ('Gym & Fitness Wear', 25, 4),
  ('Handbags', 39, 1), ('Backpacks', 39, 2), ('Wallets & Purses', 39, 3),
  ('Belts', 39, 4), ('Watches', 39, 5), ('Jewellery', 39, 6), ('Hats & Caps', 39, 7)
ON CONFLICT DO NOTHING;
