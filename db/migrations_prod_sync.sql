BEGIN;

-- 1. Lookup catalogs
CREATE TABLE IF NOT EXISTS color_catalog (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    display_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS size_catalog (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    display_order INTEGER DEFAULT 0
);

-- 2. Per-product colour, size, specs
CREATE TABLE IF NOT EXISTS product_colors (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    image_path TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_sizes (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_specifications (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    value TEXT,
    display_order INTEGER DEFAULT 0
);

-- 3. Reviews
CREATE TABLE IF NOT EXISTS product_reviews (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL,
    comment TEXT,
    verified_purchase BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT product_reviews_rating_check CHECK (rating >= 1 AND rating <= 5),
    CONSTRAINT product_reviews_unique_user UNIQUE (product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_product_reviews_product_id ON product_reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_product_reviews_created_at ON product_reviews (created_at DESC);

-- 4. Login history
CREATE TABLE IF NOT EXISTS login_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    device_label VARCHAR(255),
    success BOOLEAN DEFAULT true NOT NULL,
    logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Missing columns on existing tables
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS material VARCHAR(100),
    ADD COLUMN IF NOT EXISTS color VARCHAR(100),
    ADD COLUMN IF NOT EXISTS sleeve VARCHAR(100),
    ADD COLUMN IF NOT EXISTS style VARCHAR(100),
    ADD COLUMN IF NOT EXISTS length VARCHAR(100),
    ADD COLUMN IF NOT EXISTS fit VARCHAR(100),
    ADD COLUMN IF NOT EXISTS pattern VARCHAR(100),
    ADD COLUMN IF NOT EXISTS occasion VARCHAR(100),
    ADD COLUMN IF NOT EXISTS care_instructions TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT false;

ALTER TABLE product_images
    ADD COLUMN IF NOT EXISTS color_id INTEGER REFERENCES product_colors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS display_order INTEGER;

ALTER TABLE product_variants
    ADD COLUMN IF NOT EXISTS color_id INTEGER REFERENCES product_colors(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS size_id INTEGER REFERENCES product_sizes(id) ON DELETE SET NULL;

-- 6. Order snapshot columns
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS product_name TEXT,
    ADD COLUMN IF NOT EXISTS image_url TEXT,
    ADD COLUMN IF NOT EXISTS variant_color TEXT,
    ADD COLUMN IF NOT EXISTS variant_size TEXT,
    ADD COLUMN IF NOT EXISTS sku TEXT;

-- 7. Backfill snapshots from live product data (one time only)
UPDATE order_items oi
SET product_name = p.name,
    image_url = COALESCE(p.image, (
        SELECT pi.image_path FROM product_images pi
        WHERE pi.product_id = p.id ORDER BY pi.id LIMIT 1
    ))
FROM products p
WHERE oi.product_id = p.id
  AND oi.product_name IS NULL;

-- 8. Seed display_order on existing images
UPDATE product_images SET display_order = id WHERE display_order IS NULL;

COMMIT;
