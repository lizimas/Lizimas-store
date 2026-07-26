-- P0 migrations: run against Render AFTER prod dump
ALTER TABLE order_items ADD COLUMN product_name TEXT, ADD COLUMN image_url TEXT, ADD COLUMN variant_color TEXT, ADD COLUMN variant_size TEXT, ADD COLUMN sku TEXT;
UPDATE order_items oi SET product_name = p.name, image_url = COALESCE(p.image, (SELECT pi.image_path FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.id LIMIT 1)) FROM products p WHERE oi.product_id = p.id;
ALTER TABLE product_images ADD COLUMN display_order INTEGER;
UPDATE product_images SET display_order = id;
