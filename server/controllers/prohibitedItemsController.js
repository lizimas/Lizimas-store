// Prohibited Items admin CRUD (Phase 8, Ryan Sept 2026). See
// server/utils/prohibitedItems.js for the matching logic and
// migrations/105_prohibited_items.sql for the schema. Enforcement itself
// lives in productController.js's addProduct/updateProduct.

const pool = require("../config/database");
const { isValidProhibitedItemInput } = require("../utils/prohibitedItems");
const { logActivity } = require("../utils/activityLog");

// Write one row to prohibited_items_audit_log. Called inside the same
// transaction as the state change so a failure rolls both back.
async function writeProhibitedAudit(client, { itemId, action, before, after, actorId, note }) {
    await client.query(
        `INSERT INTO prohibited_items_audit_log
            (prohibited_item_id, action, changed_by, before_state, after_state, note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
            itemId || null,
            action,
            actorId || null,
            before ? JSON.stringify(before) : null,
            after ? JSON.stringify(after) : null,
            note || null
        ]
    );
}

exports.listProhibitedItemsAdmin = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT pi.id, pi.keyword, pi.category_id, pi.reason, pi.is_active, pi.created_at,
                    c.name AS category_name, u.name AS created_by_name
             FROM prohibited_items pi
             LEFT JOIN categories c ON c.id = pi.category_id
             LEFT JOIN users u ON u.id = pi.created_by
             ORDER BY pi.is_active DESC, pi.created_at DESC`
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.addProhibitedItemAdmin = async (req, res) => {
    try {
        const { keyword, category_id, reason } = req.body;
        if (!isValidProhibitedItemInput({ keyword, category_id })) {
            return res.status(400).json({ error: "Provide a keyword and/or a category_id." });
        }
        if (!reason || !reason.trim()) {
            return res.status(400).json({ error: "reason is required." });
        }

        const client = await pool.connect();
        let newRow;
        try {
            await client.query("BEGIN");
            const inserted = await client.query(
                `INSERT INTO prohibited_items (keyword, category_id, reason, created_by)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [keyword ? keyword.trim() : null, category_id || null, reason.trim(), req.user.userId]
            );
            newRow = inserted.rows[0];

            await writeProhibitedAudit(client, {
                itemId: newRow.id,
                action: "created",
                before: null,
                after: newRow,
                actorId: req.user.userId
            });

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }

        logActivity(req.user.userId, "prohibited_item_added", "prohibited_item", newRow.id,
            keyword ? `Keyword: ${keyword}` : `Category #${category_id}`);

        res.status(201).json(newRow);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "This keyword is already on the prohibited list." });
        }
        res.status(500).json({ error: error.message });
    }
};

exports.updateProhibitedItemAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { keyword, category_id, reason, is_active } = req.body;

        const existing = await pool.query("SELECT * FROM prohibited_items WHERE id = $1", [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Prohibited item not found." });
        const beforeRow = existing.rows[0];

        const fields = [];
        const values = [];
        let i = 1;
        if (keyword !== undefined) { fields.push(`keyword = ${i++}`); values.push(keyword ? keyword.trim() : null); }
        if (category_id !== undefined) { fields.push(`category_id = ${i++}`); values.push(category_id || null); }
        if (reason !== undefined) { fields.push(`reason = ${i++}`); values.push(reason); }
        if (is_active !== undefined) { fields.push(`is_active = ${i++}`); values.push(is_active === true); }
        fields.push(`updated_at = now()`);

        if (fields.length === 1) return res.status(400).json({ error: "Nothing to update." });

        const client = await pool.connect();
        let updatedRow;
        try {
            await client.query("BEGIN");
            values.push(id);
            const updated = await client.query(
                `UPDATE prohibited_items SET ${fields.join(", ")} WHERE id = ${i} RETURNING *`,
                values
            );
            updatedRow = updated.rows[0];

            // Pick the action label that best describes the change.
            let action = "updated";
            if (beforeRow.is_active === true && updatedRow.is_active === false) action = "deactivated";
            else if (beforeRow.is_active === false && updatedRow.is_active === true) action = "reactivated";

            await writeProhibitedAudit(client, {
                itemId: id,
                action,
                before: beforeRow,
                after: updatedRow,
                actorId: req.user.userId,
                note: JSON.stringify(req.body)
            });

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }

        logActivity(req.user.userId, "prohibited_item_updated", "prohibited_item", id, JSON.stringify(req.body));

        res.json(updatedRow);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "This keyword is already on the prohibited list." });
        }
        res.status(500).json({ error: error.message });
    }
};

exports.deleteProhibitedItemAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query("SELECT * FROM prohibited_items WHERE id = $1", [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: "Prohibited item not found." });
        const beforeRow = existing.rows[0];

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM prohibited_items WHERE id = $1", [id]);

            await writeProhibitedAudit(client, {
                itemId: id,
                action: "deleted",
                before: beforeRow,
                after: null,
                actorId: req.user.userId
            });

            await client.query("COMMIT");
        } catch (e) {
            await client.query("ROLLBACK");
            throw e;
        } finally {
            client.release();
        }

        logActivity(req.user.userId, "prohibited_item_deleted", "prohibited_item", id, "");
        res.json({ message: "Removed." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
