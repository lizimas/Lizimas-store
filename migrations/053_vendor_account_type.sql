BEGIN;

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS referral_source VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_account_type_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('individual', 'company'));
  END IF;
END $$;

COMMENT ON COLUMN public.vendors.account_type IS
  'Individual or Company, chosen at registration. Individual vendors are asked for a national ID at verification; Company vendors are asked for a URSB registration number instead.';

COMMENT ON COLUMN public.vendors.referral_source IS
  'Optional: how the vendor heard about Lizimas Store. Free text, collected at registration for marketing insight only.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '053_vendor_account_type.sql',
  'Adds vendors.account_type (individual/company) and vendors.referral_source, supporting the two-step registration wizard where KYC verification (registration number or national ID) is completed after login rather than at signup.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
