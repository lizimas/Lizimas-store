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

COMMIT;
