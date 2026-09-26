// Admin panel Users & Permissions (migration 133, Ryan Sept 2026).
//
// The owner (role 'admin') has everything. A team member (role
// 'admin_staff') only gets the sections ticked for them. This file is the
// single source of truth for:
//   - the permission list shown on the Assign Permissions screen,
//   - which API paths each permission opens (checked on every request),
//   - which admin tabs each permission shows.
// Anything not listed here stays owner-only (e.g. managing admin users).

const AP_ROLES = [
    { code: "ap_dashboard", label: "Dashboard & Analytics", description: "Dashboard, Analytics and Performance Reports",
      tabs: ["overview", "analytics", "performance"] },
    { code: "ap_products", label: "Products & Inventory", description: "Products, Categories, Product Tiers, Prohibited Items",
      tabs: ["products", "categories", "product-tiers-admin", "prohibited-items-admin"] },
    { code: "ap_marketing", label: "Promotions & Discounts", description: "Homepage Promotions, Discount Promotions, Discount Codes, Flash Sales",
      tabs: ["promotions", "product-discounts", "discounts", "flash-sales"] },
    { code: "ap_orders", label: "Orders & Returns", description: "Orders, returns and refunds",
      tabs: ["orders"] },
    { code: "ap_vendors", label: "Vendors", description: "Vendors, KYC, payouts, statements, Brand Authorizations, Payment Instruments, Consignments, Ad Campaigns",
      tabs: ["vendors", "brand-authorizations-admin", "payment-instruments-admin", "consignments-admin", "ad-campaigns-admin"] },
    { code: "ap_customers", label: "Customers & Support", description: "Customers, Live Support, Team Messages, Support Team",
      tabs: ["customers", "support", "team-messages", "support-team"] },
    { code: "ap_staff", label: "Staff & Approvals", description: "Staff accounts, product approvals, deletion requests, trash, sessions, activity log",
      tabs: ["staff"] },
    { code: "ap_security", label: "Security", description: "Login attempts, account issue reports, unlocking accounts",
      tabs: ["security"] }
];
const AP_CODES = AP_ROLES.map((r) => r.code);
// Tabs every admin user can open (their own account, shared notes).
const ALWAYS_TABS = ["account", "notes"];

// [path prefix, permission(s)] - first match wins, so more specific first.
// "*" = any signed-in admin user; missing = owner only.
const PATH_RULES = [
    ["/api/admin/my-access", "*"],
    ["/api/admin/notes", "*"],
    ["/api/admin/admin-users", null],

    ["/api/admin/stats", "ap_dashboard"],
    ["/api/admin/visitor-stats", "ap_dashboard"],
    ["/api/admin/analytics", "ap_dashboard"],
    ["/api/admin/performance", "ap_dashboard"],
    ["/api/search/stats", "ap_dashboard"],

    ["/api/admin/products/pending", ["ap_products", "ap_staff"]],
    ["/api/admin/products", ["ap_products", "ap_staff"]],
    ["/api/admin/product-tiers", "ap_products"],
    ["/api/admin/prohibited-items", "ap_products"],
    ["/api/categories", "ap_products"],
    ["/api/products", "ap_products"],
    ["/api/variants", "ap_products"],

    ["/api/admin/discount-codes", "ap_marketing"],
    ["/api/admin/flash-sales", "ap_marketing"],
    ["/api/admin/product-discounts", "ap_marketing"],
    ["/api/admin/promotion-campaigns", "ap_marketing"],
    ["/api/admin/vendor-promotions", ["ap_marketing", "ap_vendors"]],
    ["/api/promotions", "ap_marketing"],

    ["/api/admin/orders", "ap_orders"],
    ["/api/admin/returns", ["ap_orders", "ap_vendors"]],

    ["/api/admin/vendors", "ap_vendors"],
    ["/api/admin/vendor-messages", "ap_vendors"],
    ["/api/admin/vendor-payouts", "ap_vendors"],
    ["/api/admin/billing", "ap_vendors"],
    ["/api/admin/jumia", "ap_vendors"],
    ["/api/admin/brand-authorizations", "ap_vendors"],
    ["/api/admin/payment-instruments", "ap_vendors"],
    ["/api/admin/consignments", "ap_vendors"],
    ["/api/admin/ad-campaigns", "ap_vendors"],
    ["/api/admin/ad-settings", "ap_vendors"],
    ["/api/admin/dropoff-points", "ap_vendors"],
    ["/api/admin/handovers", "ap_vendors"],
    ["/api/admin/pickers", "ap_vendors"],

    ["/api/admin/customers", "ap_customers"],
    ["/api/admin/staff-messages", "ap_customers"],
    ["/api/admin/staff-messaging", "ap_customers"],
    ["/api/admin/support", "ap_customers"],
    ["/api/chat", "ap_customers"],

    ["/api/admin/staff-sessions", "ap_staff"],
    ["/api/admin/staff", "ap_staff"],
    ["/api/admin/activity-log", "ap_staff"],
    ["/api/admin/deletion-requests", "ap_staff"],
    ["/api/admin/trash", "ap_staff"],

    ["/api/admin/security", "ap_security"]
];

function cleanPath(url) {
    return String(url || "").split("?")[0].replace(/\/+$/, "");
}

// Returns "*", an array of codes, or null (owner only).
function permissionsForPath(url) {
    const p = cleanPath(url);
    for (const [prefix, perm] of PATH_RULES) {
        if (p === prefix || p.startsWith(prefix + "/")) {
            if (perm === "*" || perm === null) return perm;
            return Array.isArray(perm) ? perm : [perm];
        }
    }
    return null;
}

function canAccessPath(permissions, url) {
    const need = permissionsForPath(url);
    if (need === "*") return true;
    if (!need) return false;
    const have = Array.isArray(permissions) ? permissions : [];
    return need.some((c) => have.includes(c));
}

function sanitizePermissions(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.filter((c) => AP_CODES.includes(c)))];
}

function tabsFor(permissions) {
    const have = sanitizePermissions(permissions);
    const tabs = new Set(ALWAYS_TABS);
    AP_ROLES.forEach((r) => { if (have.includes(r.code)) r.tabs.forEach((t) => tabs.add(t)); });
    return [...tabs];
}

// Account-changing endpoints that take a user id. A team member may never
// use them on the owner or on another admin user.
const TARGETS_USER_RE = /^\/api\/admin\/(staff|customers|security\/unlock)\/(\d+)(\/|$)/;
function targetUserId(url) {
    const m = cleanPath(url).match(TARGETS_USER_RE);
    return m ? Number(m[2]) : null;
}

module.exports = { AP_ROLES, AP_CODES, ALWAYS_TABS, permissionsForPath, canAccessPath, sanitizePermissions, tabsFor, targetUserId };
