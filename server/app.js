const express = require("express");
const cors = require("cors");
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
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));
app.use(generalLimiter);
app.use(logVisitor);

// Database connection
require("./config/database");

// Routes
const routes = require("./routes");
app.use("/api", routes);

// Static files
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(express.static(path.join(__dirname, "../client")));

// Upload and multipart errors must return JSON, not an HTML crash page,
// or the admin panel shows a raw stack trace to the user.
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

    console.error("Unhandled error:", err);
    res.status(500).json({ message: "Something went wrong on the server." });
});

// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Lizimas Store API is running"
    });
});

module.exports = app;
