const pool = require("../config/database");

// Shared rate-limit store backed by PostgreSQL.
//
// express-rate-limit's default MemoryStore keeps counts per process, so with
// several instances behind a load balancer each one enforces its own separate
// limit. This store keeps a single counter that every instance shares.
//
// On a database error the store fails open: the request is allowed rather than
// blocked. A rate limiter that is briefly unavailable should not take down
// login for everyone. Per-account protections (admin lockout, OTP attempt
// limits) remain in force regardless.
class PostgresStore {
  constructor(prefix = "rl") {
    this.prefix = prefix;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  prefixKey(key) {
    return `${this.prefix}:${key}`;
  }

  // Occasionally clear rows whose window has long passed. Keys that are
  // never seen again would otherwise linger indefinitely. Runs on roughly
  // 1% of calls, so it costs almost nothing and needs no scheduler.
  async sweepExpired() {
    if (Math.random() > 0.01) return;
    try {
      await pool.query("DELETE FROM rate_limit_hits WHERE expires_at < NOW() - INTERVAL '1 hour'");
    } catch (error) {
      console.error("Rate limit store sweep failed:", error.message);
    }
  }

  async increment(key) {
    this.sweepExpired();
    const k = this.prefixKey(key);
    const windowMs = this.windowMs;

    try {
      const { rows } = await pool.query(
        `INSERT INTO rate_limit_hits (key, hits, expires_at)
         VALUES ($1, 1, NOW() + ($2::bigint * INTERVAL '1 millisecond'))
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE
                    WHEN rate_limit_hits.expires_at < NOW() THEN 1
                    ELSE rate_limit_hits.hits + 1
                  END,
           expires_at = CASE
                          WHEN rate_limit_hits.expires_at < NOW()
                            THEN NOW() + ($2::bigint * INTERVAL '1 millisecond')
                          ELSE rate_limit_hits.expires_at
                        END
         RETURNING hits, expires_at`,
        [k, windowMs]
      );

      return {
        totalHits: rows[0].hits,
        resetTime: new Date(rows[0].expires_at)
      };
    } catch (error) {
      console.error("Rate limit store increment failed:", error.message);
      return { totalHits: 1, resetTime: new Date(Date.now() + windowMs) };
    }
  }

  async decrement(key) {
    try {
      await pool.query(
        `UPDATE rate_limit_hits SET hits = GREATEST(hits - 1, 0)
         WHERE key = $1 AND expires_at >= NOW()`,
        [this.prefixKey(key)]
      );
    } catch (error) {
      console.error("Rate limit store decrement failed:", error.message);
    }
  }

  async resetKey(key) {
    try {
      await pool.query("DELETE FROM rate_limit_hits WHERE key = $1", [this.prefixKey(key)]);
    } catch (error) {
      console.error("Rate limit store resetKey failed:", error.message);
    }
  }
}

module.exports = { PostgresStore };
