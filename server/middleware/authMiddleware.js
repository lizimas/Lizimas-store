const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { resolveVendorContext } = require("../utils/vendorContext");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set. Refusing to start with an insecure default.");
}

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

        if (decoded.pending2FA || decoded.pendingSetup) {
            return res.status(401).json({ error: "Incomplete login. Please finish signing in." });
        }

        req.user = decoded;
        if (req.user && req.user.id == null && req.user.userId != null) {
            req.user.id = req.user.userId;
        }
        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired token. Please log in again." });
    }
}

// Accepts a pendingSetup token OR a full session token.
// Used only for the 2FA enrolment endpoints.
async function requireAuthOrSetup(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided. Please log in." });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.pending2FA) {
            return res.status(401).json({ error: "Incomplete login. Please finish signing in." });
        }

        req.user = decoded;
        if (req.user && req.user.id == null && req.user.userId != null) {
            req.user.id = req.user.userId;
        }
        req.isSetupToken = !!decoded.pendingSetup;
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
        if (req.user && req.user.id == null && req.user.userId != null) {
            req.user.id = req.user.userId;
        }
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

// Allows admin, product_staff, and store_manager - used for product add/edit endpoints.
// Role-specific behavior (pending approval, publish, delete restrictions) is handled
// inside the controllers themselves, not by this middleware.
function requireStaffOrAdmin(req, res, next) {
    const allowedRoles = ["admin", "product_staff", "store_manager"];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: "Staff or admin access required." });
    }
    next();
}

// Live chat is answered by dedicated support agents and by admins. Product
// staff and store managers are deliberately excluded - they have no reason
// to see customer conversations.
function requireSupportOrAdmin(req, res, next) {
    const allowedRoles = ["admin", "customer_support"];
    if (!req.user || !allowedRoles.includes(req.user.role)) {
        return res.status(403).json({ error: "Support or admin access required." });
    }
    next();
}

// Third-party marketplace sellers. Kept separate from requireStaffOrAdmin:
// vendors are external accounts and must never fall into a role check meant
// for internal staff. Ownership of a given product/order is still checked
// inside the controllers (a vendor role alone does not imply access to a
// specific row).
//
// Also admits vendor_staff (migrations/107, vendor Users/Roles) - a vendor's
// own staff sub-accounts. Either way, resolves req.vendorId and
// req.vendorStaffRoles here, once per request, via
// server/utils/vendorContext.js: req.vendorStaffRoles is null for the
// vendor owner (unrestricted) or an array of vc_* codes for staff. The ~30
// controller functions that used to each run their own
// "SELECT id FROM vendors WHERE user_id = $1" now read req.vendorId
// instead - that single change is what makes every one of them work for a
// staff login too, with no per-controller staff-awareness needed. A staff
// login whose vendor_staff_users row is disabled, or that resolves to no
// vendor at all, gets req.vendorId = null and is turned away downstream
// exactly like a vendor with no profile always was (unchanged 404 shape).
async function requireVendor(req, res, next) {
    if (!req.user || (req.user.role !== "vendor" && req.user.role !== "vendor_staff")) {
        return res.status(403).json({ error: "Vendor access required." });
    }
    const { vendorId, staffRoles } = await resolveVendorContext(req.user);
    req.vendorId = vendorId;
    req.vendorStaffRoles = staffRoles;
    next();
}

module.exports = { requireAuth, requireAuthOrSetup, requireAdmin, requireStaffOrAdmin, requireSupportOrAdmin, requireVendor, optionalAuth };
