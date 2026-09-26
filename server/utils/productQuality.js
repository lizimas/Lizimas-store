// Per-listing Quality/Content Score (September 2026 - see migrations/108_product_quality_score.sql's header).
// Pure/stateless: takes a product-shaped object plus its image count and
// returns {score, maxScore, tips}. Called from addProduct/updateProduct in
// productController.js right before the INSERT/UPDATE, so the score is
// always cached fresh on the row rather than computed on every read.
//
// The rubric below is a starting point, same spirit as commissionEngine's
// default rate and sellerScore's weights (see PENDING.md) - tune the point
// values here once there's real listing data to judge them against.

const pool = require("../config/database");

const RUBRIC = [
    {
        key: "images",
        label: "Add at least 3 product photos",
        points: 30,
        score: (p, imageCount) => {
            if (imageCount >= 4) return 30;
            if (imageCount === 3) return 28;
            if (imageCount === 2) return 22;
            if (imageCount === 1) return 15;
            return 0;
        }
    },
    {
        key: "description",
        label: "Write a detailed description (150+ characters)",
        points: 25,
        score: (p) => {
            const len = String(p.description || "").trim().length;
            if (len >= 150) return 25;
            if (len >= 50) return Math.round(10 + (len - 50) * (15 / 100));
            if (len > 0) return Math.round((len / 50) * 10);
            return 0;
        }
    },
    {
        key: "title",
        label: "Use a clear, descriptive title (10-120 characters, not all caps)",
        points: 10,
        score: (p) => {
            const name = String(p.name || "").trim();
            if (name.length < 10 || name.length > 120) return 0;
            const letters = name.replace(/[^a-zA-Z]/g, "");
            const isShouting = letters.length > 8 && letters === letters.toUpperCase();
            return isShouting ? 4 : 10;
        }
    },
    {
        key: "brand",
        label: "Fill in the Brand",
        points: 10,
        score: (p) => (p.brand ? 10 : 0)
    },
    {
        key: "identifiers",
        label: "Add a GTIN/barcode or manufacturer part number (MPN)",
        points: 10,
        score: (p) => (p.gtin || p.mpn ? 10 : 0)
    },
    {
        key: "attributes",
        label: "Fill in the product attributes (material, color, package size, etc.)",
        points: 15,
        score: (p) => {
            const fields = [p.material, p.color, p.sleeve, p.style, p.length, p.fit,
                p.pattern, p.care_instructions, p.occasion, p.package_size, p.warranty_months];
            const filled = fields.filter((v) => v !== null && v !== undefined && String(v).trim() !== "").length;
            return Math.round((filled / fields.length) * 15);
        }
    }
];

function computeQualityScore(product, imageCount) {
    let total = 0;
    let maxTotal = 0;
    const tips = [];

    for (const rule of RUBRIC) {
        const earned = Math.max(0, Math.min(rule.points, rule.score(product, imageCount)));
        total += earned;
        maxTotal += rule.points;
        if (earned < rule.points) {
            tips.push({ label: rule.label, points: rule.points, earned });
        }
    }

    // Worst-missed first, so the vendor fixes whatever moves the score most.
    tips.sort((a, b) => (b.points - b.earned) - (a.points - a.earned));

    return {
        score: Math.round((total / maxTotal) * 100),
        maxScore: 100,
        tips
    };
}

// Advisory duplicate check: does this vendor already have another listing
// in the same category whose name is a close match? pg_trgm similarity,
// not exact match, so "Men's Blue Cotton Shirt" still catches "Mens Blue
// Cotton Shirt". Scoped to the SAME vendor only - cross-vendor duplicate
// policing is a moderation/catalog decision, not something to guess at
// here - and to the same category, so "Shirt" in Men's Clothing doesn't
// flag against an unrelated "Shirt" in a different section.
async function findPossibleDuplicate(vendorId, name, categoryId, excludeProductId) {
    if (!name || !categoryId) return null;
    const { rows } = await pool.query(
        `SELECT id, name, similarity(name, $2) AS sim
         FROM products
         WHERE vendor_id = $1 AND category_id = $3 AND deleted_at IS NULL
           AND ($4::int IS NULL OR id != $4)
           AND similarity(name, $2) > 0.55
         ORDER BY sim DESC
         LIMIT 1`,
        [vendorId, name, categoryId, excludeProductId || null]
    );
    return rows.length > 0 ? rows[0] : null;
}

module.exports = { computeQualityScore, findPossibleDuplicate, RUBRIC };
