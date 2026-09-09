const pool = require("../config/database");

const PURCHASED_STATUSES = ["delivered"];

// GET /api/reviews/product/:id
exports.getProductReviews = async (req, res) => {
    try {
        const { id } = req.params;

        const summary = await pool.query(
            `SELECT COUNT(*)::int AS total,
                    COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS average,
                    COUNT(*) FILTER (WHERE rating = 5)::int AS five,
                    COUNT(*) FILTER (WHERE rating = 4)::int AS four,
                    COUNT(*) FILTER (WHERE rating = 3)::int AS three,
                    COUNT(*) FILTER (WHERE rating = 2)::int AS two,
                    COUNT(*) FILTER (WHERE rating = 1)::int AS one
             FROM product_reviews WHERE product_id = $1`,
            [id]
        );

        const reviews = await pool.query(
            `SELECT r.id, r.rating, r.comment, r.verified_purchase, r.created_at,
                    r.vendor_response, r.vendor_response_at,
                    COALESCE(NULLIF(u.display_name, ''), u.name) AS reviewer_name
             FROM product_reviews r
             JOIN users u ON u.id = r.user_id
             WHERE r.product_id = $1
             ORDER BY r.created_at DESC
             LIMIT 50`,
            [id]
        );

        res.json({ summary: summary.rows[0], reviews: reviews.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST /api/reviews/product/:id
exports.upsertReview = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const { rating, comment } = req.body;

        const numeric = Number(rating);
        if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
            return res.status(400).json({ error: "Rating must be a whole number from 1 to 5" });
        }

        const purchased = await pool.query(
            `SELECT 1 FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status = ANY($3)
             LIMIT 1`,
            [userId, id, PURCHASED_STATUSES]
        );
        const verified = purchased.rowCount > 0;

        if (!verified) {
            return res.status(403).json({
                error: "Only customers who have received this item can review it"
            });
        }

        const result = await pool.query(
            `INSERT INTO product_reviews (product_id, user_id, rating, comment, verified_purchase)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (product_id, user_id)
             DO UPDATE SET rating = EXCLUDED.rating,
                           comment = EXCLUDED.comment,
                           verified_purchase = EXCLUDED.verified_purchase,
                           updated_at = CURRENT_TIMESTAMP
             RETURNING id, rating, comment, verified_purchase, created_at`,
            [id, userId, numeric, (comment || "").trim() || null, verified]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// DELETE /api/reviews/:reviewId
exports.deleteReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const isAdmin = req.user.role === "admin";

        const result = isAdmin
            ? await pool.query(`DELETE FROM product_reviews WHERE id = $1 RETURNING id`, [reviewId])
            : await pool.query(`DELETE FROM product_reviews WHERE id = $1 AND user_id = $2 RETURNING id`, [reviewId, req.user.userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Review not found or not yours" });
        }
        res.json({ deleted: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Vendor reviews view (Task #63) --------------------------------------
// A vendor can see every review left on their own products and reply
// publicly - the reply never edits or removes the review itself; admin
// keeps that power via the existing deleteReview above.

// GET /api/vendors/reviews
exports.getVendorReviews = async (req, res) => {
    try {
        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const result = await pool.query(
            `SELECT r.id, r.product_id, r.rating, r.comment, r.verified_purchase, r.created_at,
                    r.vendor_response, r.vendor_response_at,
                    p.name AS product_name, p.image AS product_image,
                    COALESCE(NULLIF(u.display_name, ''), u.name) AS reviewer_name
             FROM product_reviews r
             JOIN products p ON p.id = r.product_id
             JOIN users u ON u.id = r.user_id
             WHERE p.vendor_id = $1
             ORDER BY r.created_at DESC`,
            [vendorId]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PATCH /api/vendors/reviews/:reviewId/response
exports.respondToReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const { response } = req.body;
        if (!response || !String(response).trim()) {
            return res.status(400).json({ error: "response is required." });
        }

        const vendorRow = await pool.query("SELECT id FROM vendors WHERE user_id = $1", [req.user.userId]);
        if (vendorRow.rows.length === 0) {
            return res.status(404).json({ error: "No vendor profile found for this account." });
        }
        const vendorId = vendorRow.rows[0].id;

        const result = await pool.query(
            `UPDATE product_reviews r
             SET vendor_response = $1, vendor_response_at = now()
             FROM products p
             WHERE r.product_id = p.id AND r.id = $2 AND p.vendor_id = $3
             RETURNING r.id, r.vendor_response, r.vendor_response_at`,
            [response, reviewId, vendorId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Review not found on one of your products." });
        }
        res.json({ message: "Response saved.", review: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
