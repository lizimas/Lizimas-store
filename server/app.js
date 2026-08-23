const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
require("dotenv").config();

const { generalLimiter } = require("./middleware/rateLimiter");
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
app.use("/", require("./routes/product-page"));

// Static files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(__dirname, "../client")));

// Upload and multipart errors must return JSON, not an HTML crash page,
// or the admin panel shows a raw stack trace to the user.
// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Lizimas Store API is running"
    });
});

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
