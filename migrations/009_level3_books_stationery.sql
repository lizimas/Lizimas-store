-- 009: Books & Stationery level 2 and level 3
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
--
-- Level-2 ids (208-211) were assigned by the sequence at insert time and are
-- local values. On Render, insert the level-2 rows first and use the returned ids.

INSERT INTO categories (name, parent_id, display_order) VALUES
  ('School Supplies', 9, 1), ('Office Supplies', 9, 2), ('Books', 9, 3), ('Art & Craft', 9, 4);

INSERT INTO categories (name, parent_id, display_order) VALUES
  ('Exercise Books', 208, 1), ('Textbooks', 208, 2), ('Pens & Pencils', 208, 3),
  ('Mathematical Sets', 208, 4), ('School Bags', 208, 5),
  ('Paper & Printing', 209, 1), ('Files & Folders', 209, 2),
  ('Staplers & Punches', 209, 3), ('Desk Accessories', 209, 4),
  ('Fiction', 210, 1), ('Non-Fiction', 210, 2), ('Children''s Books', 210, 3),
  ('Religious Books', 210, 4),
  ('Drawing & Colouring', 211, 1), ('Craft Materials', 211, 2)
ON CONFLICT DO NOTHING;
