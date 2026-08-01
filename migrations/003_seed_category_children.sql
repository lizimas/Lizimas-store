-- 003: Seed the 31 children and the Books & Stationery parent
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
--
-- Parent ids are local values. Render must be adapted before running.
-- Beverages and Personal Care were already nested by 002.

BEGIN;

INSERT INTO categories (name, description, display_order)
VALUES ('Books & Stationery', 'Books, school and office supplies.', 6);

UPDATE categories SET display_order = 1 WHERE id = 1;  -- Supermarket
UPDATE categories SET display_order = 2 WHERE id = 6;  -- Electronics
UPDATE categories SET display_order = 3 WHERE id = 2;  -- Apparel & Boutique
UPDATE categories SET display_order = 4 WHERE id = 8;  -- Home & Living
UPDATE categories SET display_order = 5 WHERE id = 4;  -- Cleaning & Essentials
UPDATE categories SET display_order = 3 WHERE id = 3;  -- Beverages
UPDATE categories SET display_order = 4 WHERE id = 5;  -- Personal Care

INSERT INTO categories (name, parent_id, display_order) VALUES
  ('Groceries', 1, 1), ('Fruits & Vegetables', 1, 2), ('Bakery', 1, 5),
  ('Fresh Meat & Poultry', 1, 6), ('Toys', 1, 7),
  ('Mobiles & Wearables', 6, 1), ('TV', 6, 2), ('Audio', 6, 3),
  ('Computers & Accessories', 6, 4), ('Gaming', 6, 5), ('IT Accessories', 6, 6),
  ('Children''s Clothing', 2, 1), ('Women''s Clothing', 2, 2),
  ('Men''s Clothing', 2, 3), ('Sunglasses', 2, 4), ('Sportswear', 2, 5),
  ('Kitchen Appliances', 8, 1), ('Home Appliances', 8, 2), ('Major Appliances', 8, 3),
  ('Cooking & Dining', 8, 4), ('Home Furniture', 8, 5), ('Outdoor Furniture', 8, 6),
  ('Décor', 8, 7),
  ('Brushes', 4, 1), ('Mops & Buckets', 4, 2), ('Laundry Detergents', 4, 3),
  ('Air Fresheners', 4, 4), ('Storage Baskets & Organizers', 4, 5),
  ('Hangers & Hooks', 4, 6);

COMMIT;
