-- 007: Level-3 categories under Supermarket
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
-- Parent ids are local values.

INSERT INTO categories (name, parent_id, display_order) VALUES
  ('Rice & Grains', 10, 1), ('Flour & Baking', 10, 2), ('Cooking Oil & Fats', 10, 3),
  ('Sugar & Sweeteners', 10, 4), ('Salt, Spices & Seasoning', 10, 5),
  ('Pasta & Noodles', 10, 6), ('Canned & Packaged Food', 10, 7),
  ('Breakfast Cereals', 10, 8), ('Sauces & Condiments', 10, 9),
  ('Fresh Fruits', 11, 1), ('Fresh Vegetables', 11, 2), ('Herbs', 11, 3),
  ('Packaged & Cut Produce', 11, 4),
  ('Soft Drinks', 3, 1), ('Water', 3, 2), ('Juices', 3, 3),
  ('Tea', 3, 4), ('Coffee', 3, 5), ('Energy & Sports Drinks', 3, 6),
  ('Bath & Body', 5, 1), ('Skincare', 5, 2), ('Hair Care', 5, 3),
  ('Oral Care', 5, 4), ('Deodorants & Fragrance', 5, 5),
  ('Shaving & Grooming', 5, 6), ('Feminine Care', 5, 7), ('Baby Care', 5, 8),
  ('Bread', 12, 1), ('Cakes', 12, 2), ('Biscuits & Cookies', 12, 3),
  ('Pastries & Snacks', 12, 4),
  ('Beef', 13, 1), ('Goat & Mutton', 13, 2), ('Chicken', 13, 3),
  ('Fish & Seafood', 13, 4), ('Eggs', 13, 5), ('Processed Meats', 13, 6),
  ('Educational Toys', 14, 1), ('Dolls & Figures', 14, 2),
  ('Outdoor & Sports Toys', 14, 3), ('Puzzles & Games', 14, 4),
  ('Baby & Toddler Toys', 14, 5)
ON CONFLICT DO NOTHING;
