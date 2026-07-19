const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
require("dotenv").config();

const { generalLimiter } = require("./middleware/rateLimiter");
const logVisitor = require("./middleware/visitorLogger");

const app = express();

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

// Test route
app.get("/", (req, res) => {
    res.json({
        message: "Lizimas Store API is running"
    });
});

module.exports = app;
