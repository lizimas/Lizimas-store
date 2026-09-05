BEGIN;

CREATE TABLE IF NOT EXISTS public.vendors (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL
                        REFERENCES public.users(id) ON DELETE CASCADE,
  business_name       VARCHAR(200) NOT NULL,
  registration_number VARCHAR(100),
  national_id_number  VARCHAR(50),
  phone               VARCHAR(20) NOT NULL,
  physical_address    TEXT,
  momo_number         VARCHAR(20),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  rejection_reason    TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         INTEGER REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendors_status_check
    CHECK (status IN ('pending','approved','rejected','suspended'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_user_id
  ON public.vendors (user_id);

CREATE INDEX IF NOT EXISTS idx_vendors_status
  ON public.vendors (status);

COMMENT ON TABLE public.vendors IS
  'Third-party sellers on the marketplace. One row per vendor, linked to a users row with role = ''vendor''. Reviewed the same way submitted products are: pending -> approved/rejected by an admin.';

COMMENT ON INDEX public.uq_vendors_user_id IS
  'One vendor profile per user account.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '049_vendors.sql',
  'Vendors table with KYC fields (business name, registration number, national ID, phone, address, MoMo payout number) and an approval status workflow.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
