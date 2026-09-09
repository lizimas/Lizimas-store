-- 064_vendor_followers.sql
-- Customers can follow a vendor's storefront (spec: "Followers - customers
-- can follow, Lizimas owns the system" - the vendor itself never manages
-- this list, only sees the count). One row per (vendor, customer) pair;
-- following twice is a no-op via the unique constraint rather than an
-- application-level check.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_followers (
    id          SERIAL PRIMARY KEY,
    vendor_id   INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vendor_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_followers_vendor ON public.vendor_followers (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_followers_user ON public.vendor_followers (user_id);

COMMENT ON TABLE public.vendor_followers IS
    'A customer following a vendor storefront. Lizimas owns the whole feature - vendors only ever see their own follower COUNT, never the list of who.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '064_vendor_followers.sql',
    'vendor_followers table - one row per (vendor, customer) follow, unique so following twice is a no-op.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
