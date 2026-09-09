const pool = require("../config/database");
const { getActiveCommissionRule } = require("../utils/commissionEngine");

// Admin-only view of the commission engine: every category alongside the
// rate that actually applies to it right now (its own rule if it has one,
// otherwise inherited from the nearest ancestor, otherwise the
// marketplace-wide default), plus the default rule itself. Ancestor
// resolution is done in memory rather than per-row SQL recursion since the
// category tree (~200 rows) is small and already needs to be loaded whole
// for the admin table anyway.
exports.listCommissionRules = async (req, res) => {
    try {
        const categoriesResult = await pool.query(
            "SELECT id, name, parent_id FROM categories ORDER BY parent_id NULLS FIRST, display_order, name"
        );
        const categories = categoriesResult.rows;

        const rulesResult = await pool.query(
            "SELECT * FROM commission_rules WHERE status = 'active'"
        );
        const ownRuleByCategory = new Map();
        let defaultRule = null;
        for (const rule of rulesResult.rows) {
            if (rule.category_id === null) {
                defaultRule = rule;
            } else {
                ownRuleByCategory.set(rule.category_id, rule);
            }
        }

        const categoryById = new Map(categories.map(c => [c.id, c]));

        function resolveEffectiveRule(categoryId) {
            let currentId = categoryId;
            const visited = new Set();
            while (currentId != null && !visited.has(currentId)) {
                visited.add(currentId);
                if (ownRuleByCategory.has(currentId)) {
                    return { rule: ownRuleByCategory.get(currentId), inheritedFrom: currentId === categoryId ? null : currentId };
                }
                const cat = categoryById.get(currentId);
                currentId = cat ? cat.parent_id : null;
            }
            return { rule: defaultRule, inheritedFrom: "default" };
        }

        const rows = categories.map(cat => {
            const { rule, inheritedFrom } = resolveEffectiveRule(cat.id);
            return {
                category_id: cat.id,
                category_name: cat.name,
                parent_id: cat.parent_id,
                has_own_rule: ownRuleByCategory.has(cat.id),
                effective_rate: rule ? Number(rule.commission_rate) : null,
                effective_fixed_fee: rule ? Number(rule.fixed_processing_fee) : null,
                effective_rule_id: rule ? rule.id : null,
                inherited_from: inheritedFrom
            };
        });

        res.json({
            default: defaultRule ? {
                id: defaultRule.id,
                commission_rate: Number(defaultRule.commission_rate),
                fixed_processing_fee: Number(defaultRule.fixed_processing_fee),
                effective_from: defaultRule.effective_from
            } : null,
            categories: rows
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Shared by both routes below: category_id null sets the marketplace-wide
// default, otherwise a category-specific override. Never edits an active
// row in place - closes it out (status='expired', effective_to=now()) and
// inserts a new active row in the same transaction, so a rate an order
// already copied stays exactly what it was (spec section 33, once orders
// actually do that copying - not wired up yet, but the versioning has to
// exist from day one or every rate change becomes a silent rewrite of
// history).
async function setCommissionRule(categoryId, body, adminUserId) {
    const rate = Number(body.commission_rate);
    const fixedFee = body.fixed_processing_fee != null ? Number(body.fixed_processing_fee) : 0;
    const taxRate = body.tax_rate != null ? Number(body.tax_rate) : 0;
    const taxIncluded = body.commission_tax_included !== false;

    if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
        const err = new Error("Commission rate must be a number between 0 and 1 (e.g. 0.15 for 15%).");
        err.status = 400;
        throw err;
    }
    if (!Number.isFinite(fixedFee) || fixedFee < 0) {
        const err = new Error("Fixed processing fee must be zero or a positive number.");
        err.status = 400;
        throw err;
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        await client.query(
            `UPDATE commission_rules
                SET status = 'expired', effective_to = now(), updated_by = $2, updated_at = now()
              WHERE COALESCE(category_id, -1) = COALESCE($1, -1) AND status = 'active'`,
            [categoryId, adminUserId]
        );

        const inserted = await client.query(
            `INSERT INTO commission_rules
                (category_id, commission_rate, fixed_processing_fee, tax_rate, commission_tax_included, status, created_by, updated_by)
             VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)
             RETURNING *`,
            [categoryId, rate, fixedFee, taxRate, taxIncluded, adminUserId]
        );

        await client.query("COMMIT");
        return inserted.rows[0];
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

exports.setCategoryCommissionRule = async (req, res) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId)) {
            return res.status(400).json({ error: "Invalid category id." });
        }
        const category = await pool.query("SELECT id FROM categories WHERE id = $1", [categoryId]);
        if (category.rows.length === 0) {
            return res.status(404).json({ error: "Category not found." });
        }

        const rule = await setCommissionRule(categoryId, req.body, req.user.userId);
        res.json({ message: "Commission rate updated.", rule });

    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
};

exports.setDefaultCommissionRule = async (req, res) => {
    try {
        const rule = await setCommissionRule(null, req.body, req.user.userId);
        res.json({ message: "Default commission rate updated.", rule });

    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
};

// Clears a category's own override so it goes back to inheriting from its
// parent / the marketplace default. Simply expires the active row without
// inserting a replacement.
exports.clearCategoryCommissionRule = async (req, res) => {
    try {
        const categoryId = Number(req.params.id);
        if (!Number.isInteger(categoryId)) {
            return res.status(400).json({ error: "Invalid category id." });
        }

        await pool.query(
            `UPDATE commission_rules
                SET status = 'expired', effective_to = now(), updated_by = $2, updated_at = now()
              WHERE category_id = $1 AND status = 'active'`,
            [categoryId, req.user.userId]
        );

        res.json({ message: "Category now inherits its parent/default commission rate." });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Used by the vendor product-upload pricing preview (spec section 8/58):
// given a category and a vendor's desired payout, returns what the
// customer will pay. No auth requirement beyond being a logged-in vendor -
// enforced by the router this is mounted on.
//
// Deliberately returns ONLY customerPrice/vendorPayout, never
// commissionRate or commissionAmount: sellers must never be able to see
// or derive Lizimas' take rate from their own dashboard (Ryan, Sept 2026).
// This route is vendor-only, so the redaction happens here rather than in
// calculatePricing() itself, which other, non-vendor-facing callers may
// still want the full breakdown from.
exports.previewPricing = async (req, res) => {
    try {
        const { calculatePricing } = require("../utils/commissionEngine");
        const { category_id, desired_payout } = req.body;

        const result = await calculatePricing({
            vendorPayout: desired_payout,
            categoryId: category_id ? Number(category_id) : null
        });

        res.json({
            customerPrice: result.customerPrice,
            vendorPayout: result.vendorPayout
        });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
