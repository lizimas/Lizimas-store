-- Shared rate-limit state for express-rate-limit.
-- MemoryStore keeps counts per process, so with multiple instances behind
-- Render's load balancer each container enforced its own separate limit.
-- This table gives every instance one shared counter.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
    key         TEXT PRIMARY KEY,
    hits        INTEGER NOT NULL DEFAULT 0,
    expires_at  TIMESTAMP NOT NULL
);

-- Supports the sweep of expired rows.
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_expires_at
    ON rate_limit_hits (expires_at);
