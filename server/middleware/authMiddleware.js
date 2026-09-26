const jwt = require("jsonwebtoken");
const pool = require("../config/database");
const { resolveVendorContext } = require("../utils/vendorContext");
const { canAccessPath, targetUserId } = require("../utils/adminPermissions");
const { tokenFrom } = require("../utils/sessionCookie");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not set. Refusing to start with an insecure default.");
}

// A soft-deleted or blocked account can't use a token it was issued before.
function isAccountEnded(row) {
    return !!(row && (row.deleted_at || row.blocked_at));
}

async function requireAuth(req, res, next) {
    // Bearer JWT, or the httpOnly session cookie picked by X-LZ-Session
    // (server/utils/sessionCookie.js).
    const token = tokenFrom(req);
    if (!token) {
        return res.status(401).json({ error: "No token provided. Please log in." });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.sessionToken) {
            // Also reads the account's state, so deleting or blocking an
            // account ends every session it already has straight away -
            // not just new logins (a login token otherwise lasts days).
            const sessionResult = await pool.query(
                `SELECT s.id, u.deleted_at, u.blocked_at, u.is_active, u.role AS db_role, u.admin_permissions
                 FROM sessions s LEFT JOIN users u ON u.id = s.user_id
                 WHERE s.session_token = $1`,
                [decoded.sessionToken]
            );

            if (sessionResult.rows.length === 0) {
                return res.status(401).json({ error: "Session has been logged out. Please log in again." });
            }
            if (isAccountEnded(sessionResult.rows[0])) {
                return res.status(401).json({ error: "This account is no longer active. Please contact Lizimas Store." });
            }
            // Admin team members (migration 133): permissions are read fresh
            // on every request, so a change or a disable applies at once.
            const acct = sessionResult.rows[0];
            if (acct.db_role === "admin_staff") {
                if (acct.is_active === false) {
                    return res.status(401).json({ error: "This account has been disabled. Please contact the store owner." });
                }
                decoded.role = "admin_staff";
                decoded.adminPermissions = acct.admin_permissions || [];
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
    // Bearer JWT, or the httpOnly session cookie picked by X-LZ-Session
    // (server/utils/sessionCookie.js).
    const token = tokenFrom(req);
    if (!token) {
        return res.status(401).json({ error: "No token provided. Please log in." });
    }

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
    const token = tokenFrom(req);
    if (!token) {
        req.user = null;
        return next();
    }

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

// Admin team members (role admin_staff, migration 133) pass an admin/staff
// gate only for the sections ticked for them (server/utils/adminPermissions.js).
// Once allowed they act as "admin" inside that section, so every controller's
// existing admin behaviour applies; realRole keeps who they really are.
// They can never act on the owner's or another admin user's account.
async function admitAdminStaff(req, res) {
    const url = req.originalUrl || req.url;
    if (!canAccessPath(req.user.adminPermissions, url)) {
        res.status(403).json({ error: "You don't have permission for this section. Ask the store owner for access.", code: "no_permission" });
        return false;
    }
    const target = targetUserId(url);
    if (target) {
        try {
            const r = await pool.query("SELECT role FROM users WHERE id = $1", [target]);
            if (r.rows.length && ["admin", "admin_staff"].includes(r.rows[0].role)) {
                res.status(403).json({ error: "Only the store owner can change admin accounts.", code: "no_permission" });
                return false;
            }
        } catch (error) {
            res.status(500).json({ error: "Something went wrong." });
            return false;
        }
    }
    req.user.realRole = "admin_staff";
    req.user.role = "admin";
    return true;
}

function roleGate(allowedRoles, deniedMessage) {
    return async function (req, res, next) {
        if (req.user && req.user.role === "admin_staff") {
            if (await admitAdminStaff(req, res)) next();
            return;
        }
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: deniedMessage });
        }
        next();
    };
}

const requireAdmin = roleGate(["admin"], "Admin access required.");

// Owner-only: admin team members are refused even with every permission.
function requireOwnerAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin" || req.user.realRole === "admin_staff") {
        return res.status(403).json({ error: "Only the store owner can do this.", code: "no_permission" });
    }
    next();
}

// Allows admin, product_staff, and store_manager - used for product add/edit endpoints.
// Role-specific behavior (pending approval, publish, delete restrictions) is handled
// inside the controllers themselves, not by this middleware.
const requireStaffOrAdmin = roleGate(["admin", "product_staff", "store_manager"], "Staff or admin access required.");

// Live chat is answered by dedicated support agents and by admins. Product
// staff and store managers are deliberately excluded - they have no reason
// to see customer conversations.
const requireSupportOrAdmin = roleGate(["admin", "customer_support"], "Support or admin access required.");

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

module.exports = { requireAuth, requireAuthOrSetup, requireAdmin, requireOwnerAdmin, requireStaffOrAdmin, requireSupportOrAdmin, requireVendor, optionalAuth };
