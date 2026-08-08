CREATE TABLE IF NOT EXISTS product_description_blocks (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    type VARCHAR(20) NOT NULL CHECK (type IN ('image','text','heading')),
    body TEXT,
    image_url TEXT,
    image_width INTEGER,
    image_height INTEGER,
    alt_text VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pdb_image_needs_url CHECK (type <> 'image' OR image_url IS NOT NULL),
    CONSTRAINT pdb_text_needs_body  CHECK (type = 'image' OR body IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pdb_product_position
    ON product_description_blocks(product_id, position);
