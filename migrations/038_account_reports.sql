CREATE TABLE IF NOT EXISTS account_reports (
  id            SERIAL PRIMARY KEY,
  report_type   TEXT NOT NULL,
  email         TEXT NOT NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message       TEXT,
  ip            TEXT,
  user_agent    TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  admin_note    TEXT,
  reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_reports_status  ON account_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_reports_email   ON account_reports (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_account_reports_user    ON account_reports (user_id);
