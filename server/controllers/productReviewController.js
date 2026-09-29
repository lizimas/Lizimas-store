// Product Approval (Ryan, Sept 2026) - Admin › Staff & Approvals.
//
//   GET  /api/admin/product-reviews/meta         reasons, statuses, flags
//   GET  /api/admin/product-reviews              list with filters + counts
//   GET  /api/admin/product-reviews/:id          everything for one review
//   POST /api/admin/product-reviews/:id/decision approve / reject /
//                                                request_changes / investigate / draft
//   POST /api/admin/product-reviews/bulk         bulk approve / reject
//   POST /api/admin/product-reviews/:id/notes    internal note
//   PUT  /api/admin/product-reviews/:id/flags    admin flags
//   POST /api/admin/product-reviews/:id/market-price  record another store's prices
//
// Rules (reasons, allowed moves, price flags) live in utils/productReview.js.
const pool = require("../config/database");
const R = require("../utils/productReview");
const { logActivity } = require("../utils/activityLog");
const { checkProductAgainstProhibitedList } = require("../utils/prohibitedItems");
const { ACTIVE_DISCOUNT_LATERAL } = require("../utils/productDiscounts");

const PAGE_SIZE = 20;
const REVIEWABLE = Object.keys(R.STATUS_LABELS);

let notify = null;
function vendorNotify(vendorId, type, context) {
    if (!notify) notify = require("./vendorController").createVendorNotification;
    return notify(vendorId, type, context).catch((e) => console.warn("vendor notification failed:", e.message));
}

async function actorName(user) {
    if (!user) return null;
    const r = await pool.query("SELECT name, email FROM users WHERE id = $1", [user.userId]).catch(() => ({ rows: [] }));
    return (r.rows[0] && (r.rows[0].name || r.rows[0].email)) || user.role || null;
}

async function recordEvent(db, productId, e) {
    await db.query(
        `INSERT INTO product_review_events (product_id, action, from_status, to_status, reason_code, reason_text, actor_id, actor_name, actor_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [productId, e.action, e.from || null, e.to || null, e.reasonCode || null, e.reasonText || null,
         e.actorId || null, e.actorName || null, e.actorRole || null]);
}
exports.recordEvent = recordEvent;

exports.meta = (req, res) => {
    res.json({
        statuses: R.STATUS_LABELS,
        reasons: R.REASONS.map(({ code, label, vendor }) => ({ code, label, vendor })),
        flags: R.FLAGS,
        actions: Object.fromEntries(Object.entries(R.ACTIONS).map(([k, v]) => [k, { to: v.to, from: v.from, own_only: !!v.ownOnly }]))
    });
};

// ---------------------------------------------------------------- list ----
exports.list = async (req, res) => {
    try {
        const q = req.query || {};
        const status = REVIEWABLE.includes(q.status) ? q.status : (q.status === "all" ? null : "pending");
        const where = ["p.deleted_at IS NULL"];
        const params = [];
        const add = (sql, v) => { params.push(v); where.push(sql.replace("$?", "$" + params.length)); };
        if (status) add("p.status = $?", status);
        else where.push(`p.status IN ('pending','changes_requested','under_investigation','rejected','draft')`);
        if (q.category) add("p.category_id = $?", Number(q.category));
        if (q.seller === "lizimas") where.push("p.vendor_id IS NULL");
        else if (q.seller) add("p.vendor_id = $?", Number(q.seller));
        if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add("p.created_at >= $?::date", q.from);
        if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add("p.created_at < ($?::date + 1)", q.to);
        if (q.flag && R.FLAGS[q.flag]) add("$? = ANY(p.review_flags)", q.flag);
        if (q.q && String(q.q).trim()) {
            params.push("%" + String(q.q).trim() + "%");
            const n = "$" + params.length;
            where.push(`(p.name ILIKE ${n} OR p.sku ILIKE ${n} OR p.lizimas_sku ILIKE ${n})`);
        }
        const whereSql = where.join(" AND ");
        const page = Math.max(1, parseInt(q.page, 10) || 1);
        const sort = q.sort === "oldest" ? "p.created_at ASC" : q.sort === "price" ? "p.price DESC" : "p.created_at DESC";

        const [rows, total, counts, sellers, categories] = await Promise.all([
            pool.query(
                `SELECT p.id, p.name, p.sku, p.lizimas_sku, p.price, p.status, p.image, p.created_at, p.updated_at,
                        p.vendor_id, p.category_id, p.review_flags, p.quality_score, p.stock,
                        c.name AS category_name, v.business_name AS vendor_business_name, u.name AS submitted_by_name,
                        (SELECT COUNT(*)::int FROM product_images pi WHERE pi.product_id = p.id) AS photo_count
                   FROM products p
                   LEFT JOIN categories c ON c.id = p.category_id
                   LEFT JOIN vendors v ON v.id = p.vendor_id
                   LEFT JOIN users u ON u.id = p.created_by
                  WHERE ${whereSql}
                  ORDER BY ${sort}, p.id DESC
                  LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params),
            pool.query(`SELECT COUNT(*)::int AS n FROM products p WHERE ${whereSql}`, params),
            pool.query(`SELECT status, COUNT(*)::int AS n FROM products WHERE deleted_at IS NULL
                         AND status IN ('pending','changes_requested','under_investigation','rejected','draft') GROUP BY status`),
            pool.query(`SELECT DISTINCT v.id, v.business_name FROM products p JOIN vendors v ON v.id = p.vendor_id
                         WHERE p.deleted_at IS NULL AND p.status <> 'approved' ORDER BY v.business_name`),
            pool.query(`SELECT DISTINCT c.id, c.name FROM products p JOIN categories c ON c.id = p.category_id
                         WHERE p.deleted_at IS NULL AND p.status <> 'approved' ORDER BY c.name`)
        ]);
        const byStatus = {}; counts.rows.forEach((r) => { byStatus[r.status] = r.n; });
        res.json({
            items: rows.rows, total: total.rows[0].n, page, page_size: PAGE_SIZE,
            counts: byStatus, sellers: sellers.rows, categories: categories.rows
        });
    } catch (e) {
        console.error("product review list:", e);
        res.status(500).json({ error: "Could not load products for review." });
    }
};

// -------------------------------------------------------------- detail ----
async function priceComparison(product) {
    const internal = product.category_id ? (await pool.query(
        `SELECT p.id, p.name, p.price FROM products p
          WHERE p.category_id = $1 AND p.status = 'approved' AND p.deleted_at IS NULL AND p.id <> $2 AND p.price > 0
          ORDER BY p.created_at DESC LIMIT 300`, [product.category_id, product.id])).rows : [];
    // Prefer products that are really alike (same key words / size), else the whole category.
    const attr = R.keyAttribute(product.name);
    const alike = internal.filter((x) => R.similarity(x.name, product.name) >= 0.5 && (!attr || R.keyAttribute(x.name) === attr));
    const basis = alike.length >= 3 ? alike : internal;
    const stats = R.priceStats(basis.map((x) => x.price), product.price, 3);
    const market = (await pool.query(
        `SELECT source, search_term, lowest_price, typical_price, highest_price, product_count, checked_by_name, checked_at
           FROM market_price_checks WHERE product_id = $1 ORDER BY checked_at DESC LIMIT 5`, [product.id])).rows;
    const term = R.marketSearchTerm(product);
    const range = (m) => ({ lowest: m.lowest_price, typical: m.typical_price, highest: m.highest_price });
    const marketRows = market.map((m) => ({ ...m, result: R.marketFlag(product.price, range(m)) }));
    // No Jumia prices for this product yet: show the latest ones recorded for a
    // very similar product (same size/capacity) as a reference.
    let reference = null;
    if (!market.length) {
        const cands = (await pool.query(
            `SELECT DISTINCT ON (m.product_id) m.product_id, p.name, m.lowest_price, m.typical_price, m.highest_price, m.product_count,
                    m.checked_by_name, m.checked_at, similarity(p.name, $1) AS sim
               FROM market_price_checks m JOIN products p ON p.id = m.product_id
              WHERE m.product_id <> $2 AND similarity(p.name, $1) > 0.45
              ORDER BY m.product_id, m.checked_at DESC`, [product.name, product.id]).catch(() => ({ rows: [] }))).rows
            .filter((x) => !attr || !R.keyAttribute(x.name) || R.keyAttribute(x.name) === attr)
            .sort((a, b) => b.sim - a.sim);
        if (cands[0]) reference = { ...cands[0], result: R.marketFlag(product.price, range(cands[0])) };
    }
    const last = market[0] ? market[0].checked_at : null;
    return {
        internal: { ...stats, basis: basis === alike && alike.length >= 3 ? "similar" : "category" },
        market: marketRows,
        market_reference: reference,
        combined: R.combinedVerdict(stats.result && stats.result.flag, marketRows[0] && marketRows[0].result.flag),
        market_required: Number(product.price) >= R.MARKET_CHECK_THRESHOLD,
        market_missing: R.needsMarketCheck(product.price, last),
        market_threshold: R.MARKET_CHECK_THRESHOLD,
        market_max_age_days: R.MARKET_CHECK_MAX_AGE_DAYS,
        market_search: { term, jumia_url: R.jumiaSearchUrl(term) }
    };
}

async function compliance(product, images) {
    const out = { checks: [] };
    const add = (key, label, state, detail) => out.checks.push({ key, label, state, detail: detail || "" });

    // Image quality: count + stored photo hashes; size notes were given at upload.
    const n = images.length;
    add("images", "Photos", n >= 3 ? "ok" : n ? "warn" : "fail",
        n ? `${n} photo${n === 1 ? "" : "s"}${n < 3 ? " - vendors need at least 3" : ""}` : "No photos");
    if (product.quality_score != null) {
        add("quality", "Listing quality score", product.quality_score >= 70 ? "ok" : product.quality_score >= 40 ? "warn" : "fail", `${product.quality_score}/100`);
    }

    // Prohibited items.
    const prohibited = (await pool.query("SELECT keyword, category_id, reason FROM prohibited_items WHERE is_active = true").catch(() => ({ rows: [] }))).rows;
    const hit = checkProductAgainstProhibitedList(product, prohibited);
    add("prohibited", "Prohibited items", hit.blocked ? "fail" : "ok",
        hit.blocked ? hit.matches.map((m) => m.keyword ? `matches "${m.keyword}"${m.reason ? ` (${m.reason})` : ""}` : `category not allowed${m.reason ? ` (${m.reason})` : ""}`).join("; ") : "No match");

    // Brand authenticity: vendor selling a brand they aren't verified for.
    if (product.vendor_id && product.brand && product.brand.trim()) {
        const auth = (await pool.query(
            `SELECT status, tier FROM vendor_brand_authorizations WHERE vendor_id = $1 AND LOWER(brand_name) = LOWER($2)
              ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`, [product.vendor_id, product.brand.trim()]).catch(() => ({ rows: [] }))).rows[0];
        add("brand", "Brand authorisation", auth && auth.status === "verified" ? "ok" : "warn",
            auth ? `${product.brand}: ${String(auth.status).replace(/_/g, " ")}` : `No authorisation on file for "${product.brand}" - ask for invoices if it's a well-known brand`);
    }

    // Duplicates: same photo used elsewhere, or a very similar name.
    const hashes = images.map((i) => i.phash).filter(Boolean);
    const samePhoto = hashes.length ? (await pool.query(
        `SELECT DISTINCT p.id, p.name, p.status, v.business_name
           FROM product_images pi JOIN products p ON p.id = pi.product_id LEFT JOIN vendors v ON v.id = p.vendor_id
          WHERE pi.phash = ANY($1) AND pi.product_id <> $2 AND p.deleted_at IS NULL LIMIT 5`, [hashes, product.id]).catch(() => ({ rows: [] }))).rows : [];
    const myAttr = R.keyAttribute(product.name);
    const sameNameRaw = (await pool.query(
        `SELECT p.id, p.name, p.status, p.price, v.business_name, similarity(p.name, $1) AS sim
           FROM products p LEFT JOIN vendors v ON v.id = p.vendor_id
          WHERE p.id <> $2 AND p.deleted_at IS NULL AND similarity(p.name, $1) > 0.6
          ORDER BY sim DESC LIMIT 10`, [product.name, product.id]).catch(() => ({ rows: [] }))).rows;
    // A different size/capacity ("350ml" vs "530ml") is a different product.
    const sameName = sameNameRaw.filter((x) => { const a = R.keyAttribute(x.name); return !myAttr || !a || a === myAttr; }).slice(0, 5);
    add("duplicates", "Duplicate check", samePhoto.length ? "fail" : sameName.length ? "warn" : "ok",
        samePhoto.length ? `Same photo used on ${samePhoto.length} other listing${samePhoto.length === 1 ? "" : "s"}`
            : sameName.length ? `${sameName.length} listing${sameName.length === 1 ? "" : "s"} with a very similar name` : "No duplicates found");
    out.same_photo = samePhoto;
    out.same_name = sameName;
    return out;
}

async function sellerInfo(product) {
    if (!product.vendor_id) {
        return { own: true, name: "Lizimas Store", submitted_by: product.submitted_by_name, submitted_by_email: product.submitted_by_email };
    }
    const [v, stats, recent] = await Promise.all([
        pool.query(`SELECT v.id, v.business_name, v.phone, v.status, v.shop_id, v.slug, v.submitted_at, v.account_type,
                           u.email, u.name AS owner_name
                      FROM vendors v LEFT JOIN users u ON u.id = v.user_id WHERE v.id = $1`, [product.vendor_id]),
        pool.query(`SELECT COUNT(*)::int AS total,
                           COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                           COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
                           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
                      FROM products WHERE vendor_id = $1 AND deleted_at IS NULL`, [product.vendor_id]),
        pool.query(`SELECT id, name, price, status, image, created_at FROM products
                     WHERE vendor_id = $1 AND id <> $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 6`, [product.vendor_id, product.id])
    ]);
    const s = stats.rows[0];
    const decided = s.approved + s.rejected;
    let score = null;
    try { score = await require("../utils/sellerScore").computeSellerScore(product.vendor_id); } catch (e) { score = null; }
    return {
        own: false, ...(v.rows[0] || {}), products: s,
        approval_rate: decided ? Math.round((s.approved / decided) * 100) : null,
        seller_score: score && score.score != null ? score.score : null,
        recent: recent.rows
    };
}

exports.detail = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid product." });
        const product = (await pool.query(
            `SELECT p.*, u.name AS submitted_by_name, u.email AS submitted_by_email, v.business_name AS vendor_business_name,
                    c.name AS category_name, pd.percent AS discount_percent, rv.name AS reviewed_by_name
               FROM products p
               LEFT JOIN users u ON u.id = p.created_by
               LEFT JOIN users rv ON rv.id = p.reviewed_by
               LEFT JOIN vendors v ON v.id = p.vendor_id
               LEFT JOIN categories c ON c.id = p.category_id
               ${ACTIVE_DISCOUNT_LATERAL.replace(/products\.id/g, "p.id")}
              WHERE p.id = $1`, [id])).rows[0];
        if (!product) return res.status(404).json({ error: "Product not found." });
        const images = (await pool.query("SELECT id, image_path, phash FROM product_images WHERE product_id = $1 ORDER BY COALESCE(display_order, 999999), id", [id])).rows;
        const [prices, checks, seller, notes, history] = await Promise.all([
            priceComparison(product),
            compliance(product, images),
            sellerInfo(product),
            pool.query("SELECT id, body, author_name, created_at FROM product_review_notes WHERE product_id = $1 ORDER BY created_at DESC LIMIT 100", [id]).then((r) => r.rows),
            pool.query("SELECT action, from_status, to_status, reason_code, reason_text, actor_name, actor_role, created_at FROM product_review_events WHERE product_id = $1 ORDER BY created_at DESC LIMIT 100", [id]).then((r) => r.rows)
        ]);
        const discounted = product.discount_percent ? Math.round(Number(product.price) * (1 - Number(product.discount_percent) / 100)) : null;
        res.json({
            pricing: {
                price: Number(product.price),
                discount_percent: product.discount_percent != null ? Number(product.discount_percent) : null,
                discounted_price: discounted,
                vendor_payout: product.vendor_desired_payout != null ? Number(product.vendor_desired_payout) : null,
                commission_rate: product.commission_rate_applied != null ? Number(product.commission_rate_applied) : null,
                fixed_fee: product.fixed_fee_applied != null ? Number(product.fixed_fee_applied) : null,
                lizimas_earns: product.vendor_id && product.vendor_desired_payout != null ? Number(product.price) - Number(product.vendor_desired_payout) : null,
                // Cost: Lizimas' own buying price, or the seller's payout on a vendor product.
                cost_price: product.vendor_id
                    ? (product.vendor_desired_payout != null ? Number(product.vendor_desired_payout) : null)
                    : (product.cost_price != null ? Number(product.cost_price) : null),
                cost_source: product.vendor_id ? "payout" : "cost_price",
                margin: R.margin(discounted || product.price, product.vendor_id ? product.vendor_desired_payout : product.cost_price),
                ...prices
            },
            compliance: checks,
            seller,
            notes,
            history,
            flags: product.review_flags || [],
            status_label: R.STATUS_LABELS[product.status] || product.status
        });
    } catch (e) {
        console.error("product review detail:", e);
        res.status(500).json({ error: "Could not load the review details." });
    }
};

// ------------------------------------------------------------ decisions ----
async function applyDecision(user, productId, input, name) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const product = (await client.query(
            `SELECT p.id, p.name, p.status, p.vendor_id, p.price,
                    (SELECT MAX(checked_at) FROM market_price_checks m WHERE m.product_id = p.id) AS last_market_check_at
               FROM products p WHERE p.id = $1 AND p.deleted_at IS NULL FOR UPDATE OF p`, [productId])).rows[0];
        const v = R.validateDecision(product, input);
        if (!v.ok) { await client.query("ROLLBACK"); return { ok: false, status: product ? 400 : 404, error: v.error }; }
        // Vendor-visible text: rejection and change requests only. An
        // investigation note is internal.
        const vendorText = ["reject", "request_changes"].includes(v.action) ? v.vendorMessage : null;
        await client.query(
            `UPDATE products SET status = $2, review_reason_code = $3,
                    rejection_reason = CASE WHEN $2 IN ('rejected','changes_requested') THEN $4 WHEN $2 = 'approved' THEN NULL ELSE rejection_reason END,
                    reviewed_at = now(), reviewed_by = $5, updated_at = now()
              WHERE id = $1`,
            [productId, v.to, v.reasonCode, vendorText, user.userId]);
        await recordEvent(client, productId, { action: v.action, from: product.status, to: v.to, reasonCode: v.reasonCode,
            reasonText: v.reasonText, actorId: user.userId, actorName: name, actorRole: user.role });
        if (v.action === "investigate" && v.reasonText) {
            await client.query("INSERT INTO product_review_notes (product_id, body, author_id, author_name) VALUES ($1, $2, $3, $4)",
                [productId, "Under investigation: " + v.reasonText, user.userId, name]);
        }
        await client.query("COMMIT");
        const verb = { approve: "approved_product", reject: "rejected_product", request_changes: "requested_product_changes", investigate: "investigating_product", draft: "drafted_product" }[v.action];
        logActivity(user.userId, verb, "product", productId, `${R.STATUS_LABELS[v.to]}: "${product.name}"${v.reasonText ? ` - ${v.reasonText}` : ""}`);
        if (product.vendor_id) {
            if (v.action === "approve") vendorNotify(product.vendor_id, "product_approved", { productName: product.name });
            else if (v.action === "reject") vendorNotify(product.vendor_id, "product_rejected", { productName: product.name, reason: vendorText || "Contact Lizimas Store support for details." });
            else if (v.action === "request_changes") vendorNotify(product.vendor_id, "product_review", { productName: product.name, kind: "changes", reason: vendorText });
            else if (v.action === "investigate") vendorNotify(product.vendor_id, "product_review", { productName: product.name, kind: "investigation" });
        }
        return { ok: true, id: productId, name: product.name, status: v.to, status_label: R.STATUS_LABELS[v.to] };
    } catch (e) {
        try { await client.query("ROLLBACK"); } catch (e2) {}
        throw e;
    } finally {
        client.release();
    }
}
exports.applyDecision = applyDecision;

exports.decide = async (req, res) => {
    try {
        const out = await applyDecision(req.user, Number(req.params.id), req.body || {}, await actorName(req.user));
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ message: `${out.name} - ${out.status_label}.`, ...out });
    } catch (e) {
        console.error("product review decision:", e);
        res.status(500).json({ error: "Could not save the decision." });
    }
};

exports.bulk = async (req, res) => {
    try {
        const body = req.body || {};
        if (!["approve", "reject"].includes(body.action)) return res.status(400).json({ error: "Bulk actions are approve or reject." });
        const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
        if (!ids.length) return res.status(400).json({ error: "Select at least one product." });
        if (body.action === "reject") {
            const pre = R.validateDecision({ status: "pending" }, body);
            if (!pre.ok) return res.status(400).json({ error: pre.error });
        }
        const name = await actorName(req.user);
        const done = [], failed = [];
        for (const id of ids) {
            try {
                const out = await applyDecision(req.user, id, body, name);
                (out.ok ? done : failed).push(out.ok ? { id, name: out.name } : { id, error: out.error });
            } catch (e) { failed.push({ id, error: "Could not save" }); }
        }
        res.json({ done: done.length, failed, message: `${done.length} product${done.length === 1 ? "" : "s"} ${body.action === "approve" ? "approved" : "rejected"}${failed.length ? `, ${failed.length} skipped` : ""}.` });
    } catch (e) {
        console.error("product review bulk:", e);
        res.status(500).json({ error: "Bulk action failed." });
    }
};

// ------------------------------------------------ notes, flags, prices ----
exports.addNote = async (req, res) => {
    try {
        const body = String((req.body && req.body.body) || "").trim().slice(0, 4000);
        if (!body) return res.status(400).json({ error: "Write a note first." });
        const id = Number(req.params.id);
        const exists = (await pool.query("SELECT 1 FROM products WHERE id = $1", [id])).rows.length;
        if (!exists) return res.status(404).json({ error: "Product not found." });
        const name = await actorName(req.user);
        const row = (await pool.query(
            "INSERT INTO product_review_notes (product_id, body, author_id, author_name) VALUES ($1, $2, $3, $4) RETURNING id, body, author_name, created_at",
            [id, body, req.user.userId, name])).rows[0];
        res.status(201).json(row);
    } catch (e) {
        console.error("product review note:", e);
        res.status(500).json({ error: "Could not save the note." });
    }
};

exports.setFlags = async (req, res) => {
    try {
        const flags = [...new Set((Array.isArray(req.body && req.body.flags) ? req.body.flags : []).filter((f) => R.FLAGS[f]))];
        const id = Number(req.params.id);
        const row = (await pool.query("UPDATE products SET review_flags = $2 WHERE id = $1 RETURNING review_flags", [id, flags])).rows[0];
        if (!row) return res.status(404).json({ error: "Product not found." });
        const name = await actorName(req.user);
        await recordEvent(pool, id, { action: "flags", reasonText: flags.length ? flags.map((f) => R.FLAGS[f]).join(", ") : "Flags cleared",
            actorId: req.user.userId, actorName: name, actorRole: req.user.role });
        res.json({ flags: row.review_flags });
    } catch (e) {
        console.error("product review flags:", e);
        res.status(500).json({ error: "Could not save the flags." });
    }
};

exports.addMarketPrice = async (req, res) => {
    try {
        const body = Object.assign({}, req.body || {});
        const id = Number(req.params.id);
        const product = (await pool.query("SELECT id, price FROM products WHERE id = $1", [id])).rows[0];
        if (!product) return res.status(404).json({ error: "Product not found." });
        // "Paste the results page": read the prices out of the pasted text.
        if (body.pasted) {
            const parsed = R.parsePastedPrices(body.pasted);
            if (parsed.prices.length < 1) return res.status(400).json({ error: "No prices found in what you pasted. On the Jumia results page press Cmd+A (select all), Cmd+C (copy), then paste here." });
            const result = R.marketFlag(product.price, parsed);
            if (body.dry_run) return res.json({ parsed: { ...parsed, prices: parsed.prices.slice(0, 60) }, result });
            Object.assign(body, { lowest_price: parsed.lowest, typical_price: parsed.typical, highest_price: parsed.highest, product_count: parsed.prices.length });
        }
        const v = R.validateMarketCheck(body);
        if (!v.ok) return res.status(400).json({ error: v.error });
        const name = await actorName(req.user);
        const x = v.value;
        const row = (await pool.query(
            `INSERT INTO market_price_checks (product_id, source, search_term, lowest_price, typical_price, highest_price, product_count, checked_by, checked_by_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING source, search_term, lowest_price, typical_price, highest_price, product_count, checked_by_name, checked_at`,
            [id, x.source, x.search_term, x.lowest_price, x.typical_price, x.highest_price, x.product_count, req.user.userId, name])).rows[0];
        res.status(201).json({ ...row, result: R.marketFlag(product.price, { lowest: row.lowest_price, typical: row.typical_price, highest: row.highest_price }) });
    } catch (e) {
        console.error("market price check:", e);
        res.status(500).json({ error: "Could not save the prices." });
    }
};

// PUT /api/admin/product-reviews/:id/cost - Lizimas' buying price for its own product.
exports.setCost = async (req, res) => {
    try {
        const raw = req.body && req.body.cost_price;
        const cost = raw === "" || raw == null ? null : Math.round(Number(String(raw).replace(/[^\d.]/g, "")));
        if (cost != null && !(cost >= 0)) return res.status(400).json({ error: "Enter the cost as a number." });
        const row = (await pool.query(
            "UPDATE products SET cost_price = $2 WHERE id = $1 AND vendor_id IS NULL RETURNING price, cost_price",
            [Number(req.params.id), cost])).rows[0];
        if (!row) return res.status(404).json({ error: "Cost price is only for Lizimas' own products." });
        const name = await actorName(req.user);
        await recordEvent(pool, Number(req.params.id), { action: "cost", reasonText: cost == null ? "Cost cleared" : `Cost price UGX ${cost.toLocaleString("en-US")}`,
            actorId: req.user.userId, actorName: name, actorRole: req.user.role });
        res.json({ cost_price: row.cost_price != null ? Number(row.cost_price) : null, margin: R.margin(row.price, row.cost_price) });
    } catch (e) {
        console.error("cost price:", e);
        res.status(500).json({ error: "Could not save the cost price." });
    }
};
