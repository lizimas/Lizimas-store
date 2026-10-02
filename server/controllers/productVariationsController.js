// Variations on the vendor product form (Ryan, Oct 2026) - the "Variants"
// cards. A variation is one size / version of the product (S, M, L or 64GB,
// 128GB ...) with its own SKU, GTIN barcode, quantity and price. They are
// stored the way the colours & sizes table stores them: one product_sizes row
// and one product_variants row each, so the store, the cart and stock keep
// working unchanged. The first card is the product itself and sells at the
// product's price.
//
// Products that use colours keep the colours & sizes table; these two
// endpoints say so (usesColours) and change nothing for them.
const pool = require("../config/database");
const { canEditProduct } = require("./productController");
const { variantPriceFromPayout } = require("../utils/variantPricing");
const { withSkuSuffix } = require("../utils/sku");

const MAX_VARIATIONS = 30;
const isVendorUser = (user) => ["vendor", "vendor_staff"].includes(user && user.role);

// -> { ok, list } | { ok: false, error }   (pure, tested in test/productVariations.test.js)
function readVariations(body) {
    const raw = Array.isArray(body && body.variations) ? body.variations : null;
    if (!raw) return { ok: false, error: "No variations were sent." };
    if (raw.length > MAX_VARIATIONS) return { ok: false, error: `A product can have up to ${MAX_VARIATIONS} variations.` };
    const list = [], names = new Set(), skus = new Set();
    for (let i = 0; i < raw.length; i++) {
        const v = raw[i] || {};
        const name = String(v.name == null ? "" : v.name).trim().replace(/\s+/g, " ").slice(0, 50);
        if (!name && raw.length > 1) return { ok: false, error: `Variation ${i + 1} needs a name (for example XL or 128GB).` };
        if (names.has(name.toLowerCase())) return { ok: false, error: `Two variations are called "${name}" - each needs its own name.` };
        names.add(name.toLowerCase());
        const stock = Number(v.stock === "" || v.stock == null ? 0 : v.stock);
        if (!Number.isInteger(stock) || stock < 0) return { ok: false, error: `The quantity for "${name || "the product"}" must be a whole number of 0 or more.` };
        let payout = null;
        if (i > 0) {
            payout = Number(v.payout);
            if (!(payout > 0)) return { ok: false, error: `Enter the price for "${name}".` };
        }
        let sku = String(v.sku == null ? "" : v.sku).trim().toUpperCase();
        if (i > 0) {
            if (!sku) return { ok: false, error: `Enter the Seller SKU for "${name}".` };
            if (sku.length > 58 || !/^[A-Z0-9][A-Z0-9._\/-]*$/.test(sku)) return { ok: false, error: `SKU "${v.sku}" can only use letters, numbers and - . / _` };
            if (skus.has(sku)) return { ok: false, error: `Two variations have the SKU "${sku}" - each needs its own.` };
            skus.add(sku);
        }
        const gtin = String(v.gtin == null ? "" : v.gtin).trim().slice(0, 32);
        if (gtin && !/^[0-9A-Za-z-]{6,32}$/.test(gtin)) return { ok: false, error: `The GTIN barcode for "${name || "the product"}" should be 6 to 32 digits.` };
        list.push({ name, stock, payout, sku: sku || null, gtin: gtin || null });
    }
    return { ok: true, list };
}

async function colourCount(db, productId) {
    return (await db.query(`SELECT count(*)::int AS n FROM product_colors WHERE product_id = $1`, [productId])).rows[0].n;
}

// GET /api/vendors/products/:id/variations
exports.getVariations = async (req, res) => {
    try {
        const { id } = req.params;
        const permission = await canEditProduct(req.user, id);
        if (!permission.allowed) return res.status(permission.status).json({ error: permission.error });
        if (await colourCount(pool, id)) return res.json({ usesColours: true, variations: [] });
        const rows = (await pool.query(
            `SELECT v.id, ps.name, v.sku, v.gtin, v.stock, v.vendor_payout, v.price
               FROM product_variants v JOIN product_sizes ps ON ps.id = v.size_id AND ps.product_id = v.product_id
              WHERE v.product_id = $1 AND v.color_id IS NULL
              ORDER BY ps.display_order ASC, v.id ASC`, [id])).rows;
        res.json({
            usesColours: false,
            variations: rows.map((r) => ({ id: r.id, name: r.name, sku: r.sku, gtin: r.gtin, stock: Number(r.stock) || 0,
                payout: r.vendor_payout == null ? null : Number(r.vendor_payout), price: r.price == null ? null : Number(r.price) }))
        });
    } catch (error) {
        console.error("getVariations error:", error.message);
        res.status(500).json({ error: "Could not load the variations." });
    }
};

// PUT /api/vendors/products/:id/variations   { variations: [{ name, sku, gtin, stock, payout }] }
// The first one is the product itself. One entry with no name = no variations.
exports.saveVariations = async (req, res) => {
    const read = readVariations(req.body);
    if (!read.ok) return res.status(400).json({ error: read.error });
    const list = read.list;
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const permission = await canEditProduct(req.user, id);
        if (!permission.allowed) return res.status(permission.status).json({ error: permission.error });
        if (await colourCount(client, id)) {
            return res.status(400).json({ error: "This product uses colours - set its stock and prices in the colours & sizes table instead." });
        }
        const vendorUser = isVendorUser(req.user);
        await client.query("BEGIN");
        const prod = (await client.query(
            `SELECT id, price, sku, vendor_id, commission_rate_applied, fixed_fee_applied FROM products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
        if (!prod) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Product not found." }); }

        const prior = (await client.query(
            `SELECT v.id, lower(trim(ps.name)) AS key FROM product_variants v
               LEFT JOIN product_sizes ps ON ps.id = v.size_id AND ps.product_id = v.product_id
              WHERE v.product_id = $1 AND v.color_id IS NULL`, [id])).rows;
        const priorByKey = new Map(prior.filter((p) => p.key).map((p) => [p.key, p.id]));
        await client.query(`DELETE FROM product_sizes WHERE product_id = $1`, [id]);

        const single = list.length <= 1 && !(list[0] && list[0].name);
        const kept = new Set();
        let totalStock = 0;
        if (!single) {
            for (let i = 0; i < list.length; i++) {
                const v = list[i];
                const sizeId = (await client.query(
                    `INSERT INTO product_sizes (product_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`, [id, v.name, i + 1])).rows[0].id;
                let payout = null, price = prod.price;
                if (i > 0) {
                    if (vendorUser) {
                        payout = v.payout;
                        price = variantPriceFromPayout(prod, v.payout);
                        if (!price) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Save the product with its price first, then add the variations." }); }
                    } else price = v.payout;       // staff and admin type the customer price
                }
                const sku = i === 0 ? null : (vendorUser ? (withSkuSuffix(v.sku).sku || v.sku) : v.sku);
                const existing = priorByKey.get(v.name.toLowerCase());
                if (existing) {
                    await client.query(
                        `UPDATE product_variants SET size_id = $1, variant_name = $2, stock = $3, vendor_payout = $4, price = $5, sku = COALESCE($6, sku), gtin = $7 WHERE id = $8`,
                        [sizeId, v.name, v.stock, payout, price, sku, v.gtin, existing]);
                    kept.add(existing);
                } else {
                    const row = await client.query(
                        `INSERT INTO product_variants (product_id, variant_name, color_id, size_id, price, stock, vendor_payout, sku, gtin)
                         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8) RETURNING id`,
                        [id, v.name, sizeId, price, v.stock, payout, sku || prod.sku, v.gtin]);
                    kept.add(row.rows[0].id);
                }
                totalStock += v.stock;
            }
        }
        const gone = prior.map((p) => p.id).filter((pid) => !kept.has(pid));
        if (gone.length) await client.query(`DELETE FROM product_variants WHERE product_id = $1 AND id = ANY($2::int[])`, [id, gone]);

        // Per-variation stock is used as soon as there are variations with stock.
        if (single) await client.query(`UPDATE products SET variant_stock_enabled = false WHERE id = $1`, [id]);
        else await client.query(`UPDATE products SET variant_stock_enabled = $2, stock = $3 WHERE id = $1`, [id, totalStock > 0, totalStock]);
        await client.query("COMMIT");
        res.json({ message: single ? "The product has no variations." : "Variations saved.", count: single ? 0 : list.length, total_stock: totalStock, removed: gone.length });
    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (e) { /* already closed */ }
        console.error("saveVariations error:", error.message);
        res.status(/duplicate key|unique/i.test(error.message) ? 400 : 500)
            .json({ error: /duplicate key|unique/i.test(error.message) ? "One of the SKUs is already used by another product or variation." : "Could not save the variations." });
    } finally {
        client.release();
    }
};

exports.readVariations = readVariations;
