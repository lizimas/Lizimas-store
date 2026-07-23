const pool = require("../config/database");

/**
 * Records an action to the activity_log table for audit trail purposes.
 * Never throws - a failed log write should never block the actual action.
 * @param {number} userId - who performed the action
 * @param {string} action - e.g. "added_product", "requested_deletion", "approved_product"
 * @param {string} targetType - e.g. "product", "user"
 * @param {number} targetId
 * @param {string} details - optional human-readable detail
 */
async function logActivity(userId, action, targetType, targetId, details = null) {
    try {
        await pool.query(
            `INSERT INTO activity_log (user_id, action, target_type, target_id, details)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, action, targetType, targetId, details]
        );
    } catch (error) {
        console.error("Activity log write failed:", error);
    }
}

module.exports = { logActivity };
