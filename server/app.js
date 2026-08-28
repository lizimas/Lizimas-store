const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
require("dotenv").config();

const { generalLimiter, webhookLimiter } = require("./middleware/rateLimiter");
const logVisitor = require("./middleware/visitorLogger");

const app = express();

// Render places exactly one proxy hop in front of the app.
// Trusting one hop makes req.ip the real client address for rate limiting,
// without allowing a spoofed X-Forwarded-For to bypass the limiters.
app.set("trust proxy", 1);

// Middleware
const ALLOWED_ORIGINS = [
    "https://lizimasstore.com",
    "https://www.lizimasstore.com",
    "https://lizimas-store.onrender.com",
    "http://localhost:5000",
    "http://127.0.0.1:5000"
];

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

app.use(require("cookie-parser")());

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
}));
// Payment provider callbacks. Mounted ABOVE express.json() on purpose: the
// route parses its own raw body with express.raw() so it can verify the
// provider's signature over the exact bytes sent. Once express.json() consumes
// the stream those bytes are gone and verification cannot work.
//
// This also places it above generalLimiter, morgan and logVisitor - provider
// retries are not site visitors and should not consume a browser's bucket.
app.use("/webhooks/payments", webhookLimiter, require("./routes/paymentWebhook"));

app.use(express.json());
app.use(morgan("dev"));
app.use(generalLimiter);
app.use(logVisitor);

// Database connection
require("./config/database");

// Routes
const routes = require("./routes");
app.use("/api", routes);

app.use("/", require("./routes/sitemap"));
app.use("/", require("./routes/receipt"));
app.use("/", require("./routes/product-page"));
app.use("/", require("./routes/feed"));

// Static files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(__dirname, "../client")));

// Upload and multipart errors must return JSON, not an HTML crash page,
// or the admin panel shows a raw stack trace to the user.
// Nothing matched a route or a static file. API callers get JSON so admin
// fetch() calls can parse the failure; everyone else gets the branded page.
// Must stay after the static mounts and before the error handler.
function notFoundHandler(req, res) {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ message: "Not found." });
    }
    return res.status(404).sendFile(path.join(__dirname, "../client/404.html"));
}

app.use(notFoundHandler);

app.use((err, req, res, next) => {
    if (err && err.code === "INVALID_FILE_TYPE") {
        return res.status(400).json({ message: err.message });
    }
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "That image is larger than the 5MB limit." });
    }
    if (err && err.name === "MulterError") {
        return res.status(400).json({ message: `Upload failed: ${err.message}` });
    }

    if (err && err.message === "Not allowed by CORS") {
        return res.status(403).json({ message: "Forbidden." });
    }

    console.error("Unhandled error:", err);
    res.status(500).json({ message: "Something went wrong on the server." });
});


module.exports = app;
