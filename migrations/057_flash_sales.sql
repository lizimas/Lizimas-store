BEGIN;

CREATE TABLE IF NOT EXISTS public.flash_sales (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(120) NOT NULL,
  subtitle     VARCHAR(200),
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   INTEGER REFERENCES public.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.flash_sale_items (
  id             SERIAL PRIMARY KEY,
  flash_sale_id  INTEGER NOT NULL REFERENCES public.flash_sales(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sale_price     NUMERIC(10,2) NOT NULL CHECK (sale_price >= 0),
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_flash_sale_items_sale_product UNIQUE (flash_sale_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_flash_sale_items_sale
  ON public.flash_sale_items (flash_sale_id, display_order);

CREATE INDEX IF NOT EXISTS idx_flash_sales_active_ends
  ON public.flash_sales (is_active, ends_at);

COMMENT ON TABLE public.flash_sales IS
  'Time-boxed "Grab or Gone" style flash-sale campaigns for the homepage: a title, an end time driving a countdown, and a set of products at a special price via flash_sale_items.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '057_flash_sales.sql',
  'Flash sale campaigns (flash_sales) and their discounted products (flash_sale_items), powering a homepage countdown deals section.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
