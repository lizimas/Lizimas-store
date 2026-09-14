-- 099_statement_share_tokens.sql
-- Phase 4 - shareable statement links. A vendor can mint a short-lived
-- token for a statement so their accountant, bank, or tax authority can
-- view/download the PDF without an account.

BEGIN;

CREATE TABLE IF NOT EXISTS statement_share_tokens (
    id SERIAL PRIMARY KEY,
    statement_id INTEGER NOT NULL REFERENCES vendor_statements(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER NOT NULL DEFAULT 0,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_statement_share_tokens_token
    ON statement_share_tokens (token);

CREATE INDEX IF NOT EXISTS idx_statement_share_tokens_statement
    ON statement_share_tokens (statement_id);

COMMENT ON TABLE statement_share_tokens IS
    'Public access tokens for vendor statements. 30-day default expiry. Can be revoked. Every access increments access_count and updates last_accessed_at for audit.';

INSERT INTO schema_migrations (filename, note)
VALUES (
    '099_statement_share_tokens.sql',
    'Phase 4: statement_share_tokens - public shareable links for vendor statements.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
