// Vendor Users/Roles (Settings > Users's
// screen of the same name - Ryan, Sept 2026). A vendor owner invites
// staff sub-accounts scoped to their own shop, each holding an array of
// vc_* permission codes (see server/utils/vendorContext.js). Deliberately
// mirrors authController.js's createStaffAccount (admin-side staff
// invitations): a throwaway password, an emailed 15-minute setup link,
// must_reset_password=true - staff never receive a password directly.
//
// Every endpoint here is owner-only (req.user.role === "vendor"). A
// vendor_staff session can never reach these routes, by design (see
// migrations/107_vendor_staff_users.sql's header) - a compromised staff
// login can never grant itself more access or add another staff member.

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/database");
const { VC_ROLES } = require("../utils/vendorContext");
const { sendVendorStaffInviteEmail } = require("../utils/mailer");

const JWT_SECRET = process.env.JWT_SECRET;
const VALID_VC_CODES = VC_ROLES.map((r) => r.code);

function sanitizeRoles(roles) {
    if (!Array.isArray(roles)) return null;
    const cleaned = [...new Set(roles.filter((r) => VALID_VC_CODES.includes(r)))];
    return cleaned;
}

function requireOwner(req, res) {
    if (!req.user || req.user.role !== "vendor") {
        res.status(403).json({ error: "Only the vendor owner can manage Users." });
        return false;
    }
    if (!req.vendorId) {
        res.status(404).json({ error: "No vendor profile found for this account." });
        return false;
    }
    return true;
}

async function logStaffAudit(vendorStaffUserId, action, changedBy, beforeState, afterState) {
    try {
        await pool.query(
            `INSERT INTO vendor_staff_users_audit_log (vendor_staff_user_id, action, changed_by, before_state, after_state)
             VALUES ($1, $2, $3, $4, $5)`,
            [vendorStaffUserId, action, changedBy, beforeState ? JSON.stringify(beforeState) : null, afterState ? JSON.stringify(afterState) : null]
        );
    } catch (error) {
        console.error("Vendor staff audit log error:", error);
    }
}

// GET /api/vendors/me/staff - list of this vendor's staff, most recent first.
exports.listVendorStaff = async (req, res) => {
    try {
        if (!requireOwner(req, res)) return;

        const { rows } = await pool.query(
            `SELECT vsu.id, vsu.roles, vsu.enabled, vsu.created_at, vsu.updated_at,
                    u.id AS user_id, u.name, u.email, u.must_reset_password, u.is_active AS account_active
             FROM vendor_staff_users vsu
             JOIN users u ON u.id = vsu.user_id
             WHERE vsu.vendor_id = $1
             ORDER BY vsu.created_at DESC`,
            [req.vendorId]
        );

        res.json({
            staff: rows,
            availableRoles: VC_ROLES
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST /api/vendors/me/staff - invite a new staff member. Mirrors
// authController.js's createStaffAccount: throwaway password, emailed
// setup link, must_reset_password=true.
exports.createVendorStaffUser = async (req, res) => {
    try {
        if (!requireOwner(req, res)) return;

        const { name, email, roles } = req.body;
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: "Name is required." });
        }
        if (!email || !String(email).trim()) {
            return res.status(400).json({ error: "Email is required." });
        }
        const cleanedRoles = sanitizeRoles(roles);
        if (!cleanedRoles || cleanedRoles.length === 0) {
            return res.status(400).json({ error: `At least one role is required. Valid roles: ${VALID_VC_CODES.join(", ")}` });
        }

        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "An account with this email already exists." });
        }

        const vendorRow = await pool.query("SELECT business_name FROM vendors WHERE id = $1", [req.vendorId]);
        const businessName = vendorRow.rows[0]?.business_name || "your vendor account";

        const hashedPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

        const usernameBase = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "staff";
        let username = usernameBase;
        let usernameSuffix = 0;
        while (true) {
            const existingUsername = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
            if (existingUsername.rows.length === 0) break;
            usernameSuffix += 1;
            username = `${usernameBase}${usernameSuffix}`;
        }

        const client = await pool.connect();
        let insertedUser, staffRow;
        try {
            await client.query("BEGIN");

            const userResult = await client.query(
                "INSERT INTO users (name, email, password, role, username, is_active, must_reset_password) VALUES ($1, $2, $3, 'vendor_staff', $4, true, true) RETURNING id, name, email",
                [name.trim(), email.trim(), hashedPassword, username]
            );
            insertedUser = userResult.rows[0];

            const staffResult = await client.query(
                `INSERT INTO vendor_staff_users (user_id, vendor_id, roles, enabled, invited_by)
                 VALUES ($1, $2, $3, true, $4)
                 RETURNING id, roles, enabled, created_at`,
                [insertedUser.id, req.vendorId, cleanedRoles, req.user.userId]
            );
            staffRow = staffResult.rows[0];

            await client.query("COMMIT");
        } catch (txError) {
            await client.query("ROLLBACK");
            throw txError;
        } finally {
            client.release();
        }

        await logStaffAudit(staffRow.id, "created", req.user.userId, null, {
            name: insertedUser.name, email: insertedUser.email, roles: cleanedRoles
        });

        const inviteToken = jwt.sign(
            { userId: insertedUser.id, email: insertedUser.email, purpose: "passwordReset" },
            JWT_SECRET,
            { expiresIn: "15m" }
        );
        const setupLink = `${req.protocol}://${req.get("host")}/reset-password.html?token=${inviteToken}`;
        const inviteSent = await sendVendorStaffInviteEmail(insertedUser.email, insertedUser.name, businessName, setupLink, 15);

        res.status(201).json({
            message: inviteSent
                ? `Staff account created. A setup link has been emailed to ${insertedUser.email}. It expires in 15 minutes.`
                : `Staff account created, but the invite email to ${insertedUser.email} could not be sent.`,
            inviteSent,
            staff: {
                id: staffRow.id,
                user_id: insertedUser.id,
                name: insertedUser.name,
                email: insertedUser.email,
                roles: staffRow.roles,
                enabled: staffRow.enabled,
                created_at: staffRow.created_at
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PATCH /api/vendors/me/staff/:id/roles - replace a staff member's roles.
exports.updateVendorStaffUserRoles = async (req, res) => {
    try {
        if (!requireOwner(req, res)) return;

        const { id } = req.params;
        const cleanedRoles = sanitizeRoles(req.body.roles);
        if (!cleanedRoles) {
            return res.status(400).json({ error: `roles must be an array. Valid roles: ${VALID_VC_CODES.join(", ")}` });
        }

        const existing = await pool.query(
            "SELECT id, roles FROM vendor_staff_users WHERE id = $1 AND vendor_id = $2",
            [id, req.vendorId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Staff member not found." });
        }
        const before = existing.rows[0];

        const result = await pool.query(
            "UPDATE vendor_staff_users SET roles = $1, updated_at = now() WHERE id = $2 RETURNING id, roles, enabled",
            [cleanedRoles, id]
        );

        await logStaffAudit(id, "roles_updated", req.user.userId, { roles: before.roles }, { roles: cleanedRoles });

        res.json({ staff: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PATCH /api/vendors/me/staff/:id/enabled - enable or disable a staff login.
// A disabled staff member can still authenticate but every vendor-scoped
// endpoint 404s (see vendorContext.js's resolveVendorContext).
exports.toggleVendorStaffUserEnabled = async (req, res) => {
    try {
        if (!requireOwner(req, res)) return;

        const { id } = req.params;
        const { enabled } = req.body;
        if (typeof enabled !== "boolean") {
            return res.status(400).json({ error: "enabled must be true or false." });
        }

        const existing = await pool.query(
            "SELECT id, enabled FROM vendor_staff_users WHERE id = $1 AND vendor_id = $2",
            [id, req.vendorId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Staff member not found." });
        }
        const before = existing.rows[0];

        const result = await pool.query(
            "UPDATE vendor_staff_users SET enabled = $1, updated_at = now() WHERE id = $2 RETURNING id, roles, enabled",
            [enabled, id]
        );

        await logStaffAudit(id, enabled ? "enabled" : "disabled", req.user.userId, { enabled: before.enabled }, { enabled });

        res.json({ staff: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// DELETE /api/vendors/me/staff/:id - permanently remove a staff member's
// access. The underlying users row is deactivated rather than deleted
// (keeps order/audit history attributable), matching how admin-side staff
// removal is handled elsewhere in this codebase.
exports.deleteVendorStaffUser = async (req, res) => {
    try {
        if (!requireOwner(req, res)) return;

        const { id } = req.params;
        const existing = await pool.query(
            "SELECT id, user_id, roles, enabled FROM vendor_staff_users WHERE id = $1 AND vendor_id = $2",
            [id, req.vendorId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Staff member not found." });
        }
        const before = existing.rows[0];

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM vendor_staff_users WHERE id = $1", [id]);
            await client.query("UPDATE users SET is_active = false WHERE id = $1", [before.user_id]);
            await client.query("COMMIT");
        } catch (txError) {
            await client.query("ROLLBACK");
            throw txError;
        } finally {
            client.release();
        }

        await logStaffAudit(null, "deleted", req.user.userId, { roles: before.roles, enabled: before.enabled }, null);

        res.json({ message: "Staff member removed." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
