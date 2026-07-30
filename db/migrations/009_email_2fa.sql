ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_otp_hash TEXT,
    ADD COLUMN IF NOT EXISTS email_otp_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS email_otp_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS email_otp_last_sent_at TIMESTAMP;
