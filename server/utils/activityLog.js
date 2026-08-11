const pool = require("../config/database");

/**
 * Records an action to the activity_log table.
 *
 * Two call styles are supported. The positional form is the original and
 * still works unchanged:
 *
 *   logActivity(userId, "edited_product", "product", 21, "price changed")
 *
 * The object form carries the richer detail the audit trail needs:
 *
 *   logActivity({
 *     req,
 *     action: "product.price_change",
 *     targetType: "product",
 *     targetId: 21,
 *     before: { price: 105000 },
 *     after:  { price: 15000 }
 *   })
 *
 * Passing req fills in actor id, role, email and IP automatically, so a
 * caller cannot forget the attribution that makes an entry worth keeping.
 *
 * Never throws. A failed log write must not block the action it describes -
 * losing an audit entry is bad, failing a customer order because of it is
 * worse.
 */
async function logActivity(a, b, c, d, e) {
    let userId = null;
    let action = null;
    let targetType = null;
    let targetId = null;
    let details = null;
    let actorRole = null;
    let actorEmail = null;
    let before = null;
    let after = null;
    let ip = null;

    if (a && typeof a === "object") {
        const o = a;
        action = o.action || null;
        targetType = o.targetType || null;
        targetId = o.targetId != null ? o.targetId : null;
        details = o.details || null;
        before = o.before || null;
        after = o.after || null;

        const req = o.req;
        const u = (req && req.user) || o.actor || null;
        if (u) {
            userId = u.userId != null ? u.userId : (u.id != null ? u.id : null);
            actorRole = u.role || null;
            actorEmail = u.email || null;
        }
        if (o.userId != null) userId = o.userId;

        // Behind Cloudflare req.ip is an edge address, so prefer the
        // forwarded client address the rate limiter already relies on.
        if (req) {
            ip = req.headers["cf-connecting-ip"] || req.ip || null;
        }
        if (o.ip) ip = o.ip;
    } else {
        userId = a != null ? a : null;
        action = b || null;
        targetType = c || null;
        targetId = d != null ? d : null;
        details = e || null;
    }

    if (!action) return;

    try {
        await pool.query(
            `INSERT INTO activity_log
                 (user_id, action, target_type, target_id, details,
                  actor_role, actor_email, before_data, after_data, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                userId,
                action,
                targetType,
                targetId,
                details,
                actorRole,
                actorEmail,
                before ? JSON.stringify(before) : null,
                after ? JSON.stringify(after) : null,
                ip
            ]
        );
    } catch (error) {
        console.error("Activity log write failed:", error);
    }
}

module.exports = { logActivity };
