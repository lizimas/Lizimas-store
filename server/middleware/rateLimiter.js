const rateLimit = require("express-rate-limit");

// Strict limiter for auth endpoints (login/register) - prevents brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window per IP
  message: { error: "Too many attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General limiter for the rest of the API - prevents scraping/hammering
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // 300 requests per window per IP
  message: { error: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, generalLimiter };
