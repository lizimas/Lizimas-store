-- Variations on the vendor product form (Oct 2026): each variation card has
-- its own GTIN barcode next to its SKU, quantity and price.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS gtin VARCHAR(32);
