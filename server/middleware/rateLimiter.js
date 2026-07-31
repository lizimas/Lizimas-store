const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { PostgresStore } = require("./pgRateLimitStore");

// Render fronts the app with Cloudflare, and requests can exit via different
// Cloudflare nodes, so req.ip varies between requests from the same user and
// rate-limit counts never accumulate. CF-Connecting-IP carries the true client
// address. Falls back to req.ip when the header is absent (local development,
// or direct origin access).
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  return cf ? ipKeyGenerator(cf) : ipKeyGenerator(req.ip);
}

// Strict limiter for password login endpoints.
// Keyed on normalised email + IP so that shared carrier NAT addresses
// do not pool attempts across unrelated users.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: new PostgresStore("login"),
  keyGenerator: (req, res) => {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    return `${clientIp(req)}:${email}`;
  },
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Moderate limiter for OTP and password-reset endpoints.
// Keyed on IP only: /login/2fa carries a pendingToken rather than an email.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  store: new PostgresStore("otp"),
  keyGenerator: (req, res) => clientIp(req),
  message: { error: "Too many code requests. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Relaxed backstop across all auth routes. This is what bounds total
// login attempts from a single IP when an attacker varies the email.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  store: new PostgresStore("auth"),
  keyGenerator: (req, res) => clientIp(req),
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General limiter for the rest of the API - prevents scraping/hammering
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, otpLimiter, authLimiter, generalLimiter };
