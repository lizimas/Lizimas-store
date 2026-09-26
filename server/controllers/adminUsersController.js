// Admin panel Users & Permissions (migration 133, Ryan Sept 2026).
// The admin-side twin of the Vendor Center's Manage Users: the store owner
// invites team members (role 'admin_staff') and assigns which admin
// sections each one may use. Same invite pattern as createStaffAccount:
// a throwaway password, an emailed 15-minute setup link, and
// must_reset_password - nobody is ever sent a password.
// Every endpoint except my-access is owner-only (requireOwnerAdmin).

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { sendStaffInviteEmail } = require("../utils/mailer");
const { AP_ROLES, AP_CODES, ALWAYS_TABS, sanitizePermissions, tabsFor } = require("../utils/adminPermissions");

const JWT_SECRET = process.env.JWT_SECRET;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setupLinkFor(req, user) {
    const token = jwt.sign({ userId: user.id, email: user.email, purpose: "passwordReset" }, JWT_SECRET, { expiresIn: "15m" });
    return `${req.protocol}://${req.get("host")}/staff-reset-password.html?token=${token}&portal=admin`;
}

function shape(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        permissions: sanitizePermissions(row.admin_permissions),
        enabled: row.is_active !== false,
        pending_setup: !!row.must_reset_password,
        two_factor_enabled: !!row.two_factor_enabled,
        last_login_at: row.last_login_at || null,
        created_at: row.created_at
    };
}

// GET /api/admin/my-access - what the signed-in admin user may open.
exports.getMyAccess = async (req, res) => {
    const isOwner = req.user.realRole !== "admin_staff";
    if (isOwner) {
        return res.json({ role: "admin", owner: true, permissions: AP_CODES, tabs: null, always_tabs: ALWAYS_TABS });
    }
    const perms = sanitizePermissions(req.user.adminPermissions);
    res.json({ role: "admin_staff", owner: false, permissions: perms, tabs: tabsFor(perms), always_tabs: ALWAYS_TABS });
};

// GET /api/admin/admin-users
exports.listAdminUsers = async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT u.id, u.name, u.email, u.admin_permissions, u.is_active, u.must_reset_password,
                    u.two_factor_enabled, u.created_at,
                    (SELECT MAX(lh.logged_in_at) FROM login_history lh WHERE lh.user_id = u.id AND lh.success = true) AS last_login_at
             FROM users u
             WHERE u.role = 'admin_staff' AND u.deleted_at IS NULL
             ORDER BY u.created_at DESC`
        );
        res.json({ users: r.rows.map(shape), roles: AP_ROLES.map(({ code, label, description, tabs }) => ({ code, label, description, tabs })) });
    } catch (error) {
        console.error("List admin users error:", error);
        res.status(500).json({ error: "Could not load admin users." });
    }
};

// POST /api/admin/admin-users  { name, email, permissions[] }
exports.createAdminUser = async (req, res) => {
    try {
        const name = String((req.body && req.body.name) || "").trim().slice(0, 120);
        const email = String((req.body && req.body.email) || "").trim().toLowerCase();
        const permissions = sanitizePermissions(req.body && req.body.permissions);
        if (!name || !email) return res.status(400).json({ error: "Name and email are required." });
        if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
        if (!permissions.length) return res.status(400).json({ error: "Tick at least one permission." });

        const existing = await pool.query("SELECT id FROM users WHERE LOWER(email) = $1", [email]);
        if (existing.rows.length) return res.status(409).json({ error: "An account with this email already exists." });

        const hashed = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
        const base = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || "admin";
        let username = base;
        for (let n = 1; (await pool.query("SELECT 1 FROM users WHERE username = $1", [username])).rows.length; n++) username = `${base}${n}`;

        const r = await pool.query(
            `INSERT INTO users (name, email, password, role, username, is_active, must_reset_password, admin_permissions)
             VALUES ($1, $2, $3, 'admin_staff', $4, true, true, $5)
             RETURNING id, name, email, admin_permissions, is_active, must_reset_password, two_factor_enabled, created_at`,
            [name, email, hashed, username, permissions]
        );
        const user = r.rows[0];
        const sent = await sendStaffInviteEmail(user.email, user.name, setupLinkFor(req, user), 15).catch(() => false);
        await logActivity(req.user.userId, "create_admin_user", "user", user.id, `${user.name} <${user.email}>: ${permissions.join(", ")}`);
        res.status(201).json({
            user: shape(user),
            inviteSent: !!sent,
            message: sent
                ? `${user.name} was added. A setup link was emailed to ${user.email} (valid 15 minutes).`
                : `${user.name} was added, but the email could not be sent. Use Resend invite.`
        });
    } catch (error) {
        console.error("Create admin user error:", error);
        res.status(500).json({ error: "Could not create the user." });
    }
};

async function loadTarget(id) {
    const r = await pool.query(
        "SELECT id, name, email, admin_permissions, is_active, must_reset_password, two_factor_enabled, created_at FROM users WHERE id = $1 AND role = 'admin_staff' AND deleted_at IS NULL",
        [id]
    );
    return r.rows[0] || null;
}

// PUT /api/admin/admin-users/:id  { name?, permissions[] }
exports.updateAdminUser = async (req, res) => {
    try {
        const before = await loadTarget(req.params.id);
        if (!before) return res.status(404).json({ error: "User not found." });
        const permissions = sanitizePermissions(req.body && req.body.permissions);
        if (!permissions.length) return res.status(400).json({ error: "Tick at least one permission (or disable the user instead)." });
        const name = req.body && req.body.name ? String(req.body.name).trim().slice(0, 120) : before.name;
        const r = await pool.query(
            `UPDATE users SET name = $1, admin_permissions = $2 WHERE id = $3
             RETURNING id, name, email, admin_permissions, is_active, must_reset_password, two_factor_enabled, created_at`,
            [name, permissions, before.id]
        );
        await logActivity({ req, action: "admin_user.permissions", targetType: "user", targetId: before.id,
            before: { permissions: before.admin_permissions }, after: { permissions } });
        res.json({ user: shape(r.rows[0]), message: `Permissions for ${r.rows[0].name} saved. They apply straight away.` });
    } catch (error) {
        console.error("Update admin user error:", error);
        res.status(500).json({ error: "Could not save the user." });
    }
};

// PATCH /api/admin/admin-users/:id/enabled  { enabled }
exports.setAdminUserEnabled = async (req, res) => {
    try {
        const t = await loadTarget(req.params.id);
        if (!t) return res.status(404).json({ error: "User not found." });
        const enabled = !!(req.body && req.body.enabled);
        await pool.query("UPDATE users SET is_active = $1 WHERE id = $2", [enabled, t.id]);
        if (!enabled) await pool.query("DELETE FROM sessions WHERE user_id = $1", [t.id]);
        await logActivity(req.user.userId, enabled ? "enable_admin_user" : "disable_admin_user", "user", t.id, t.name);
        res.json({ message: enabled ? `${t.name} can sign in again.` : `${t.name} is disabled and signed out everywhere.` });
    } catch (error) {
        console.error("Enable admin user error:", error);
        res.status(500).json({ error: "Could not update the user." });
    }
};

// POST /api/admin/admin-users/:id/resend-invite
exports.resendAdminUserInvite = async (req, res) => {
    try {
        const t = await loadTarget(req.params.id);
        if (!t) return res.status(404).json({ error: "User not found." });
        await pool.query("UPDATE users SET must_reset_password = true WHERE id = $1", [t.id]);
        const sent = await sendStaffInviteEmail(t.email, t.name, setupLinkFor(req, t), 15).catch(() => false);
        await logActivity(req.user.userId, "resend_admin_user_invite", "user", t.id, t.email);
        if (!sent) return res.status(502).json({ error: `The email to ${t.email} could not be sent.` });
        res.json({ message: `A new setup link was emailed to ${t.email} (valid 15 minutes).` });
    } catch (error) {
        console.error("Resend admin invite error:", error);
        res.status(500).json({ error: "Could not send the invite." });
    }
};

// DELETE /api/admin/admin-users/:id - removes access (soft delete, history kept)
exports.deleteAdminUser = async (req, res) => {
    try {
        const t = await loadTarget(req.params.id);
        if (!t) return res.status(404).json({ error: "User not found." });
        await pool.query("UPDATE users SET deleted_at = NOW(), is_active = false WHERE id = $1", [t.id]);
        await pool.query("DELETE FROM sessions WHERE user_id = $1", [t.id]);
        await logActivity(req.user.userId, "delete_admin_user", "user", t.id, `${t.name} <${t.email}>`);
        res.json({ message: `${t.name} was removed.` });
    } catch (error) {
        console.error("Delete admin user error:", error);
        res.status(500).json({ error: "Could not remove the user." });
    }
};
