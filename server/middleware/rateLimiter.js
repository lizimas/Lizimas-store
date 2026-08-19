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

// Guest chat: conversation creation. Unauthenticated write, so this is the
// tightest of the chat buckets - a legitimate visitor opens one conversation
// and reuses its guest_token thereafter.
const chatStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  store: new PostgresStore("chat_start"),
  keyGenerator: (req, res) => clientIp(req),
  message: { error: "Too many chat requests. Please try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Guest chat: message posting. Keyed on IP only so creating extra
// conversations does not multiply the allowance. 40 per 5 minutes is well
// above human typing speed and well below a flood script.
const chatMessageLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  store: new PostgresStore("chat_msg"),
  keyGenerator: (req, res) => clientIp(req),
  message: { error: "You are sending messages too quickly. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Guest chat: polling reads. Memory-backed on purpose - a store write per
// poll would be heavier than the endpoint it protects. Generous ceiling that
// only a runaway client or a scraper would reach.
const chatPollLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 200,
  keyGenerator: (req, res) => clientIp(req),
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Account issue reports from the public footer form. Unauthenticated write
// that fans out to email, so this is the tightest bucket in the file. Keyed on
// IP only - the reporter may be locked out and cannot be trusted to identify.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  store: new PostgresStore("report"),
  keyGenerator: (req, res) => clientIp(req),
  message: { error: "Too many reports submitted. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General limiter for the rest of the API - prevents scraping/hammering
const CHAT_POLL_PATH = /^\/api\/chat\/\d+\/(messages|read)$/;

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  // Chat polling would exhaust this bucket on its own - an open widget makes
  // ~300 requests in 15 minutes - locking the customer out of checkout. Those
  // routes carry chatPollLimiter instead.
  skip: (req) => CHAT_POLL_PATH.test(String(req.originalUrl || "").split("?")[0]),
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { loginLimiter, otpLimiter, authLimiter, generalLimiter, chatStartLimiter, chatMessageLimiter, chatPollLimiter, reportLimiter };
