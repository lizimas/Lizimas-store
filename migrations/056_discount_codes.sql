BEGIN;

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id                SERIAL PRIMARY KEY,
  code              VARCHAR(30) NOT NULL,
  description       TEXT,
  discount_type     VARCHAR(10) NOT NULL,
  value             NUMERIC(10,2) NOT NULL,
  min_order_amount  NUMERIC(10,2),
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  usage_limit       INTEGER,
  times_used        INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        INTEGER REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT discount_codes_type_check CHECK (discount_type IN ('percent', 'fixed')),
  CONSTRAINT discount_codes_value_check CHECK (value > 0),
  CONSTRAINT discount_codes_percent_range_check
    CHECK (discount_type <> 'percent' OR value <= 100),
  CONSTRAINT discount_codes_usage_limit_check CHECK (usage_limit IS NULL OR usage_limit > 0),
  CONSTRAINT discount_codes_min_order_check CHECK (min_order_amount IS NULL OR min_order_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_discount_codes_code
  ON public.discount_codes (UPPER(code));

CREATE INDEX IF NOT EXISTS idx_discount_codes_active
  ON public.discount_codes (is_active);

COMMENT ON TABLE public.discount_codes IS
  'Admin-managed discount codes. One memorable code per campaign (e.g. SAVE25), percent or fixed-amount off, redeemed at checkout. times_used is incremented atomically inside the checkout transaction against usage_limit.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '056_discount_codes.sql',
  'Admin-managed discount codes table: percent or fixed amount off, optional date window, usage limit, and minimum order amount. Redeemed via orders.discount_code/discount_amount (already present from migration 041).'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
