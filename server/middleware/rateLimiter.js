const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// Strict limiter for password login endpoints.
// Keyed on normalised email + IP so that shared carrier NAT addresses
// do not pool attempts across unrelated users.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req, res) => {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}:${email}`;
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
  message: { error: "Too many code requests. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Relaxed backstop across all auth routes. This is what bounds total
// login attempts from a single IP when an attacker varies the email.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
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
