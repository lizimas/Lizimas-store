-- Vendor registration email verification.
--
-- The new multi-step vendor registration wizard verifies an applicant's
-- email address with a one-time code BEFORE any users/vendors row is
-- created (account creation only happens at the very final submit step).
-- Since there is no user row yet to hang an OTP on (unlike the existing
-- email_otp_* columns on `users`, used for login 2FA), pending codes for
-- an email address that has not registered yet live here instead.
--
-- One row per email: a fresh code request overwrites the previous one
-- rather than piling up rows for abandoned attempts.
CREATE TABLE IF NOT EXISTS vendor_registration_otp (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    code_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_registration_otp_email ON vendor_registration_otp (email);
