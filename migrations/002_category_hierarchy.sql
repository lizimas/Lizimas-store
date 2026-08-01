-- 002: Two-level category hierarchy; merges and renames
-- Applied local: 2026-08-02
-- Applied Render: NOT YET
--
-- Note: the id values below are local. Render's categories table has
-- different ids, so this must be adapted before running there.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES categories(id);

BEGIN;

-- Merge Apparel (7) into Boutique (2); Boutique survives
UPDATE products SET category_id = 2 WHERE category_id = 7;

UPDATE categories
SET name = 'Apparel & Boutique',
    description = 'Clothing, shoes, bags and fashion accessories for men, women and children.'
WHERE id = 2;

DELETE FROM categories WHERE id = 7;

-- Renames
UPDATE categories SET name = 'Cleaning & Essentials',
    description = 'Cleaning supplies, laundry and household essentials.' WHERE id = 4;
UPDATE categories SET name = 'Home & Living',
    description = 'Furniture, appliances, kitchenware and home décor.' WHERE id = 8;

-- Beverages (3) and Personal Care (5) become children of Supermarket (1)
UPDATE categories SET parent_id = 1 WHERE id IN (3, 5);

COMMIT;
