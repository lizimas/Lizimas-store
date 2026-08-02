-- 011: Promotions table for the homepage carousel slots
-- Applied local: 2026-08-02
-- Applied Render: 2026-08-02

CREATE TABLE IF NOT EXISTS promotions (
    id            SERIAL PRIMARY KEY,
    image_url     TEXT NOT NULL,
    link_url      TEXT,
    title         VARCHAR(120),
    slot          SMALLINT NOT NULL DEFAULT 1 CHECK (slot IN (1, 2)),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_promotions_slot ON promotions (slot, display_order);
