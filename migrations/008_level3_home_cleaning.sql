-- 008: Level-3 categories under Home & Living and Cleaning & Essentials
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
-- Parent ids are local values.

INSERT INTO categories (name, parent_id, display_order) VALUES
  ('Blenders & Juicers', 26, 1), ('Kettles & Flasks', 26, 2), ('Microwaves', 26, 3),
  ('Air Fryers & Toasters', 26, 4), ('Rice Cookers', 26, 5), ('Coffee & Tea Makers', 26, 6),
  ('Irons & Garment Care', 27, 1), ('Fans', 27, 2), ('Vacuum Cleaners', 27, 3),
  ('Water Dispensers', 27, 4), ('Sewing Machines', 27, 5),
  ('Refrigerators & Freezers', 28, 1), ('Washing Machines', 28, 2),
  ('Cookers & Ovens', 28, 3), ('Gas Cookers & Cylinders', 28, 4),
  ('Cookware & Saucepans', 29, 1), ('Dinnerware & Plates', 29, 2),
  ('Glassware & Mugs', 29, 3), ('Cutlery', 29, 4), ('Food Storage', 29, 5),
  ('Serving Dishes', 29, 6),
  ('Sofas & Living Room', 30, 1), ('Beds & Mattresses', 30, 2),
  ('Wardrobes & Storage', 30, 3), ('Dining Tables & Chairs', 30, 4),
  ('Desks & Office Chairs', 30, 5), ('Shelving', 30, 6),
  ('Garden Chairs & Tables', 31, 1), ('Umbrellas & Shade', 31, 2),
  ('Outdoor Storage', 31, 3),
  ('Curtains & Blinds', 32, 1), ('Rugs & Carpets', 32, 2), ('Bedding & Linen', 32, 3),
  ('Wall Art & Mirrors', 32, 4), ('Lighting & Lamps', 32, 5), ('Clocks', 32, 6),
  ('Artificial Plants', 32, 7),
  ('Scrubbing Brushes', 33, 1), ('Toilet Brushes', 33, 2),
  ('Dish Brushes & Sponges', 33, 3), ('Dusters', 33, 4),
  ('Mops', 34, 1), ('Buckets & Basins', 34, 2), ('Brooms', 34, 3),
  ('Squeegees & Wipers', 34, 4),
  ('Washing Powder', 35, 1), ('Liquid Detergent', 35, 2), ('Bar Soap', 35, 3),
  ('Fabric Softener', 35, 4), ('Bleach & Stain Remover', 35, 5),
  ('Room Sprays', 36, 1), ('Plug-ins & Diffusers', 36, 2), ('Car Fresheners', 36, 3),
  ('Laundry Baskets', 37, 1), ('Storage Boxes', 37, 2),
  ('Kitchen Organizers', 37, 3), ('Shoe Racks', 37, 4),
  ('Clothes Hangers', 38, 1), ('Wall Hooks', 38, 2), ('Drying Racks', 38, 3),
  ('Clothes Lines & Pegs', 38, 4)
ON CONFLICT DO NOTHING;
