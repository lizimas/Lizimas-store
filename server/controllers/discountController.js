const pool = require("../config/database");
const { logActivity } = require("../utils/activityLog");
const { resolveDiscountCode, DiscountError } = require("../utils/discounts");

// Short, readable, hard-to-confuse codes: no 0/O or 1/I, a memorable word
// prefix plus a few random characters - e.g. SAVE-K7M4. Collisions are
// vanishingly unlikely, but a retry loop is cheap insurance against one.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_WORDS = ["SAVE", "DEAL", "LIZI", "SHOP", "TREAT", "BONUS", "PROMO", "GIFT"];

function randomSuffix(length) {
    let out = "";
    for (let i = 0; i < length; i++) {
        out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
}

async function generateUniqueCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const word = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
        const candidate = `${word}-${randomSuffix(4)}`;
        const existing = await pool.query(
            "SELECT id FROM discount_codes WHERE UPPER(code) = UPPER($1)",
            [candidate]
        );
        if (existing.rows.length === 0) return candidate;
    }
    // Astronomically unlikely to be reached, but never loop forever.
    return `SAVE-${Date.now().toString(36).toUpperCase()}`;
}

// Public: lets the admin form fill in a fresh code before the rest of the
// form is even complete, and lets the customer-facing "generate for me"
// flow (if ever added) reuse the same generator.
exports.generateCode = async (req, res) => {
    try {
        const code = await generateUniqueCode();
        res.json({ code });
    } catch (error) {
        console.error("Generate discount code error:", error);
        res.status(500).json({ error: "Could not generate a code." });
    }
};

exports.listDiscountCodes = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, code, description, discount_type, value, min_order_amount,
                    starts_at, ends_at, usage_limit, times_used, is_active, created_at
             FROM discount_codes
             ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List discount codes error:", error);
        res.status(500).json({ error: "Failed to load discount codes." });
    }
};

// Public (no auth): the current site-wide active codes, for a lightweight
// "active promotions" read-only display (e.g. the vendor dashboard).
// Deliberately omits usage counts and ids - vendors get to know a deal is
// running, not the mechanics behind it.
exports.listActiveDiscountCodesPublic = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT code, description, discount_type, value, min_order_amount, ends_at
             FROM discount_codes
             WHERE is_active = true
               AND (starts_at IS NULL OR starts_at <= now())
               AND (ends_at IS NULL OR ends_at >= now())
               AND (usage_limit IS NULL OR times_used < usage_limit)
             ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List active discount codes error:", error);
        res.status(500).json({ error: "Failed to load active discount codes." });
    }
};

exports.createDiscountCode = async (req, res) => {
    try {
        const description = (req.body.description || "").trim() || null;
        const discountType = req.body.discount_type === "fixed" ? "fixed" : "percent";
        const value = Number(req.body.value);
        const minOrderAmount = req.body.min_order_amount !== undefined && req.body.min_order_amount !== ""
            ? Number(req.body.min_order_amount) : null;
        const startsAt = req.body.starts_at || null;
        const endsAt = req.body.ends_at || null;
        const usageLimit = req.body.usage_limit !== undefined && req.body.usage_limit !== ""
            ? parseInt(req.body.usage_limit, 10) : null;
        let code = (req.body.code || "").trim().toUpperCase();

        if (!code) code = await generateUniqueCode();

        if (!/^[A-Z0-9-]{3,30}$/.test(code)) {
            return res.status(400).json({ error: "Code must be 3-30 letters, numbers, or hyphens." });
        }
        if (!Number.isFinite(value) || value <= 0) {
            return res.status(400).json({ error: "Value must be a positive number." });
        }
        if (discountType === "percent" && value > 100) {
            return res.status(400).json({ error: "A percentage discount can't exceed 100." });
        }
        if (minOrderAmount !== null && (!Number.isFinite(minOrderAmount) || minOrderAmount < 0)) {
            return res.status(400).json({ error: "Minimum order amount must be zero or more." });
        }
        if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit <= 0)) {
            return res.status(400).json({ error: "Usage limit must be a positive whole number." });
        }

        const existing = await pool.query(
            "SELECT id FROM discount_codes WHERE UPPER(code) = UPPER($1)",
            [code]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: "That code is already in use." });
        }

        const result = await pool.query(
            `INSERT INTO discount_codes
                (code, description, discount_type, value, min_order_amount,
                 starts_at, ends_at, usage_limit, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, code, description, discount_type, value, min_order_amount,
                       starts_at, ends_at, usage_limit, times_used, is_active, created_at`,
            [code, description, discountType, value, minOrderAmount,
                startsAt, endsAt, usageLimit, req.user.userId]
        );

        await logActivity(req.user.userId, "create_discount_code", "discount_code",
            result.rows[0].id, `Created code ${code}`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("Create discount code error:", error);
        res.status(500).json({ error: "Failed to create discount code." });
    }
};

exports.setDiscountCodeActive = async (req, res) => {
    try {
        const { id } = req.params;
        const isActive = req.body.is_active === true || req.body.is_active === "true";
        const result = await pool.query(
            "UPDATE discount_codes SET is_active = $1 WHERE id = $2 RETURNING id, is_active",
            [isActive, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Discount code not found." });
        }
        await logActivity(req.user.userId, isActive ? "restore_discount_code" : "disable_discount_code",
            "discount_code", id, `${isActive ? "Enabled" : "Disabled"} code`);
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Set discount code active error:", error);
        res.status(500).json({ error: "Failed to update discount code." });
    }
};

exports.deleteDiscountCode = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            "DELETE FROM discount_codes WHERE id = $1 RETURNING id",
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Discount code not found." });
        }
        await logActivity(req.user.userId, "delete_discount_code", "discount_code", id, "Deleted code");
        res.json({ message: "Discount code deleted." });
    } catch (error) {
        console.error("Delete discount code error:", error);
        res.status(500).json({ error: "Failed to delete discount code." });
    }
};

// Public: lets the checkout page validate a typed code and show the
// resulting discount before the order is actually placed. Does not consume
// usage - only the real checkout transaction does that (see checkoutController).
exports.previewDiscountCode = async (req, res) => {
    const client = await pool.connect();
    try {
        const { code, subtotal } = req.body;
        const parsedSubtotal = Number(subtotal);
        if (!Number.isFinite(parsedSubtotal) || parsedSubtotal < 0) {
            return res.status(400).json({ error: "A valid subtotal is required." });
        }
        await client.query("BEGIN");
        const resolved = await resolveDiscountCode(client, code, parsedSubtotal);
        // Read-only check: never commit a usage change from a preview.
        await client.query("ROLLBACK");

        if (!resolved.id) {
            return res.status(400).json({ error: "Please enter a discount code." });
        }
        res.json({ code: resolved.code, discount_amount: resolved.amount });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error instanceof DiscountError) {
            return res.status(400).json({ error: error.message });
        }
        console.error("Preview discount code error:", error);
        res.status(500).json({ error: "Could not check that code." });
    } finally {
        client.release();
    }
};
