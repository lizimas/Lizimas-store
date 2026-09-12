-- Track whether Ryan has already been alerted about an abandoned vendor
-- registration attempt for a given email, so the sweep job (see
-- server/jobs/vendorSignupAbandonment.js) sends at most one alert per
-- attempt instead of re-alerting on every tick while the row sits unclaimed.
--
-- Reset to NULL whenever a fresh code is requested for that email
-- (authController.js), so a second abandoned attempt later is still
-- eligible for its own alert.

BEGIN;

ALTER TABLE vendor_registration_otp ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMPTZ;

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '086_vendor_registration_abandonment_alert.sql',
    'Adds alerted_at to vendor_registration_otp so the vendor-signup-abandonment sweep job (server/jobs/vendorSignupAbandonment.js) alerts Ryan and the applicant at most once per abandoned attempt.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
