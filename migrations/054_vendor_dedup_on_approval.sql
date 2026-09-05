BEGIN;

-- Multiple vendors may share a shop name, URSB registration number, or
-- national ID while they are only pending or rejected - that's expected,
-- since two unrelated applicants can coincidentally pick a similar name,
-- or someone can legitimately re-apply after a rejection. The rule is
-- "one account per business" only once an admin has actually approved
-- an account: these partial unique indexes only look at status =
-- 'approved' rows, so the real enforcement point is the moment an admin
-- approves a second application that collides with an already-approved
-- vendor - that UPDATE will fail, and approveVendor() turns that into a
-- clear error instead of a generic 500.

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_business_name_approved
  ON public.vendors (LOWER(TRIM(business_name)))
  WHERE status = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_registration_number_approved
  ON public.vendors (LOWER(TRIM(registration_number)))
  WHERE status = 'approved' AND registration_number IS NOT NULL AND TRIM(registration_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendors_national_id_approved
  ON public.vendors (LOWER(TRIM(national_id_number)))
  WHERE status = 'approved' AND national_id_number IS NOT NULL AND TRIM(national_id_number) <> '';

COMMENT ON INDEX public.uq_vendors_business_name_approved IS
  'One account per business: only one approved vendor may hold a given shop name (case/whitespace-insensitive). Pending or rejected rows are not restricted.';

COMMENT ON INDEX public.uq_vendors_registration_number_approved IS
  'One account per business: only one approved vendor may hold a given URSB registration number.';

COMMENT ON INDEX public.uq_vendors_national_id_approved IS
  'One account per business: only one approved vendor may hold a given national ID.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '054_vendor_dedup_on_approval.sql',
  'Partial unique indexes on vendors.business_name / registration_number / national_id_number, scoped to status = ''approved'', so a second vendor account for the same business is blocked at the point an admin approves it, not before.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
