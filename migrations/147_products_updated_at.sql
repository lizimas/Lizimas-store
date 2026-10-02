-- 147_products_updated_at.sql
-- The vendor "Manage Applications" (Channel) screens compare
-- products.updated_at with the time a product was last synced, but no
-- migration ever created that column, so the screen fails where the column
-- is missing. This adds it (when missing) and keeps it current on every
-- product update.

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.products_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_touch_updated_at ON public.products;
CREATE TRIGGER trg_products_touch_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.products_touch_updated_at();

INSERT INTO public.schema_migrations (filename, note)
VALUES ('147_products_updated_at.sql', 'products.updated_at (when missing) kept current by a trigger - used by the Channel sync screens.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
