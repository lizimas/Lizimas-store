const jwt = require("jsonwebtoken");
const pool = require("../config/database");

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env_file";

async function requireAuth(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided. Please log in." });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.sessionToken) {
            const sessionResult = await pool.query(
                "SELECT id FROM sessions WHERE session_token = $1",
                [decoded.sessionToken]
            );

            if (sessionResult.rows.length === 0) {
                return res.status(401).json({ error: "Session has been logged out. Please log in again." });
            }

            pool.query(
                "UPDATE sessions SET last_used_at = CURRENT_TIMESTAMP WHERE session_token = $1",
                [decoded.sessionToken]
            ).catch(err => console.error("Session update error:", err));
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired token. Please log in again." });
    }
}

async function optionalAuth(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        req.user = null;
        return next();
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
    } catch (error) {
        req.user = null;
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required." });
    }
    next();
}

module.exports = { requireAuth, requireAdmin, optionalAuth };
