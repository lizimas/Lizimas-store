const pool = require("../config/database");

// Resolves which vendor a request is acting on behalf of, whether the
// authenticated user is the vendor's own login (role="vendor") or one of
// that vendor's staff sub-accounts (role="vendor_staff", migrations/107).
//
// req.user.userId is always left completely alone here - it stays the
// TRUE authenticated user's own id, whichever kind of account it is. That
// matters: account-level endpoints (change password, profile, sessions,
// 2FA) all key off req.user.userId, and nothing about this feature should
// ever let a staff session's actions land on the vendor OWNER's own
// account. All this resolves is which vendors.id row the request's
// vendor-scoped work (products, orders, statements, ...) applies to.
//
// staffRoles is null for the vendor owner themselves - requireVendor
// (server/middleware/authMiddleware.js) treats null as "full access, no
// gating", so an owner login is completely unaffected by this feature.
// For a staff login it's the array of vc_* codes from vendor_staff_users
// (empty array if the row exists but was granted nothing - NOT the same
// as null, so an empty-roles staff account is correctly locked out of
// every gated action rather than silently treated as the owner).
async function resolveVendorContext(user) {
    if (!user) return { vendorId: null, staffRoles: null };

    if (user.role === "vendor") {
        const { rows } = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [user.userId]);
        return { vendorId: rows[0]?.id ?? null, staffRoles: null };
    }

    if (user.role === "vendor_staff") {
        const { rows } = await pool.query(
            "SELECT vendor_id, roles FROM vendor_staff_users WHERE user_id = $1 AND enabled = true",
            [user.userId]
        );
        if (rows.length === 0) return { vendorId: null, staffRoles: [] };
        return { vendorId: rows[0].vendor_id, staffRoles: rows[0].roles || [] };
    }

    return { vendorId: null, staffRoles: null };
}

// staffRoles === null means "the vendor owner themselves" - always allowed,
// regardless of which permission codes are asked for. Otherwise true only
// when at least one of the requested codes is present.
function hasVendorPermission(staffRoles, ...anyOf) {
    if (staffRoles === null) return true;
    if (!Array.isArray(staffRoles)) return false;
    return anyOf.some(code => staffRoles.includes(code));
}

// Express middleware factory: 403s unless the current request (already
// carrying req.vendorId/req.vendorStaffRoles from requireVendor) holds at
// least one of the given vc_* permission codes. Use on top of requireVendor
// for routes that should be narrower than "any active vendor login" - most
// routes deliberately do NOT use this yet (see PENDING.md), only the ones
// that map cleanly onto a Lizimas role.
function requireVendorPermission(...anyOf) {
    return (req, res, next) => {
        if (!hasVendorPermission(req.vendorStaffRoles, ...anyOf)) {
            return res.status(403).json({ error: "Your account doesn't have permission for this." });
        }
        next();
    };
}

const VC_ROLES = [
    { code: "vc_product_manager", label: "VC - Product Manager" },
    { code: "vc_product_viewer", label: "VC - Product Viewer" },
    { code: "vc_product_update", label: "VC - Product Update" },
    { code: "vc_order_viewer", label: "VC - Order Viewer" },
    { code: "vc_order_manager", label: "VC - Order Manager" },
    { code: "vc_order_report", label: "VC - Order Report" },
    { code: "vc_finance_viewer", label: "VC - Finance Viewer" },
    { code: "vc_promotion_manager", label: "VC - Promotion Manager" },
    { code: "vc_shop_viewer", label: "VC - Shop Viewer" },
    { code: "vc_shop_manager", label: "VC - Shop Manager" },
    { code: "vc_advertising_manager", label: "VC - Advertising Manager" }
];

module.exports = { resolveVendorContext, hasVendorPermission, requireVendorPermission, VC_ROLES };
