const pool = require("../config/database");
const cloudinary = require("../config/cloudinary");
const { logActivity } = require("../utils/activityLog");

// Upload a single file buffer to Cloudinary, returns the secure URL
function uploadBufferToCloudinary(fileBuffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "lizimas-store/products" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        );
        stream.end(fileBuffer);
    });
}

const { SIZE_RANK } = require("../utils/deliveryPricing");

// Only the four known tiers may reach the database: package_size is a
// pricing input, so an unrecognised value would silently mis-charge
// delivery rather than fail loudly.
function safePackageSize(value) {
    return SIZE_RANK[value] ? value : "Small";
}

// Add product (with optional multiple image uploads)
exports.addProduct = async (req, res) => {
    try {
        const { name, category_id, description, price, stock, package_size,
                material, color, sleeve, style, length, fit, pattern, care_instructions, occasion,
                warranty_months, brand, gtin, mpn } = req.body;

        const packageSize = safePackageSize(package_size);
        const warrantyMonths = warranty_months ? Number(warranty_months) : null;

        const status = req.user.role === "product_staff" ? "pending" : "approved";

        const uploadedFiles = req.files || [];
        const imagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );
        const mainImage = imagePaths.length > 0 ? imagePaths[0] : (req.body.image || null);

        const product = await pool.query(
            `INSERT INTO products (name,category_id,description,price,stock,image,status,created_by,
                material,color,sleeve,style,length,fit,pattern,care_instructions,occasion,package_size,warranty_months,
              brand,gtin,mpn)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
            [name, category_id, description, price, stock, mainImage, status, req.user.userId,
                material || null, color || null, sleeve || null, style || null, length || null,
                fit || null, pattern || null, care_instructions || null, occasion || null,
                packageSize, warrantyMonths,
                brand || null, gtin || null, mpn || null]
        );

        const newProduct = product.rows[0];

        const imageRecords = [];
        for (const [imgIndex, imgPath] of imagePaths.entries()) {
            const ins = await pool.query(
                `INSERT INTO product_images (product_id, image_path, display_order) VALUES ($1, $2, $3) RETURNING id, image_path`,
                [newProduct.id, imgPath, imgIndex]
            );
            imageRecords.push(ins.rows[0]);
        }

        logActivity(req.user.userId, "added_product", "product", newProduct.id, `Added "${name}" (status: ${status})`);

        const message = status === "pending"
            ? "Product submitted and is pending admin approval."
            : "Product added successfully";

        res.json({ message, product: newProduct, images: imagePaths, image_records: imageRecords });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all products
exports.getProducts = async (req, res) => {
    try {
        // Optional free-text filter. Matches the product name or its category
        // name, so "electronics" finds the section and "hisense" finds the item.
        const q = (req.query.q || "").trim();
        const params = [];
        let filter = "";

        if (q) {
            params.push(`%${q}%`);
            filter = ` AND (products.name ILIKE $${params.length} OR categories.name ILIKE $${params.length})`;
        }

        // Navigation links point at parent categories while every product is
        // filed on a leaf, so a parent has to match its entire subtree.
        const categoryName = (req.query.category || "").trim();
        if (categoryName) {
            params.push(categoryName);
            filter += ` AND products.category_id IN (
                WITH RECURSIVE subtree AS (
                    SELECT id FROM categories WHERE name = $${params.length}
                    UNION ALL
                    SELECT c.id FROM categories c
                      JOIN subtree s ON c.parent_id = s.id
                )
                SELECT id FROM subtree
            )`;
        }

        const products = await pool.query(
            `SELECT products.*, categories.name AS category,
                    COALESCE(
                      (SELECT pi.image_path FROM product_images pi
                       WHERE pi.product_id = products.id
                       ORDER BY COALESCE(pi.display_order, 999999) ASC, pi.id ASC
                       LIMIT 1),
                      products.image
                    ) AS card_image,
                    (SELECT pi.image_path FROM product_images pi
                     WHERE pi.product_id = products.id
                     ORDER BY COALESCE(pi.display_order, 999999) ASC, pi.id ASC
                     OFFSET 1 LIMIT 1
                    ) AS hover_image
             FROM products
             LEFT JOIN categories ON products.category_id = categories.id
             WHERE products.status = 'approved' AND products.deleted_at IS NULL${filter}
             ORDER BY products.id DESC`,
            params
        );

        res.json(products.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get the logged-in staff member's own products, with pending deletion request status
// Capability check rather than a role test, so new roles need no handler changes.
async function canEditProduct(user, productId) {
    if (user.role === "admin") return { allowed: true };
    const row = (await pool.query(
        `SELECT created_by FROM products WHERE id = $1 AND deleted_at IS NULL`,
        [productId]
    )).rows[0];
    if (!row) return { allowed: false, status: 404, error: "Product not found." };
    if (Number(row.created_by) !== Number(user.userId)) {
        return { allowed: false, status: 403,
            error: "You can only edit products you created. Ask the owner or an admin." };
    }
    return { allowed: true };
}

exports.getMyProducts = async (req, res) => {
    try {
        // Store managers get read-only visibility of the whole catalogue so they
        // can supervise it. Editing stays scoped to the creator: a staff edit
        // flips the product back to pending, so letting one person edit another's
        // product would silently pull it off sale. `is_own` tells the client
        // which rows are editable.
        const isManager = req.user.role === "store_manager";

        const scopeClause = isManager
            ? ""
            : "AND p.created_by = $1";

        const result = await pool.query(
            `SELECT p.*, dr.status AS deletion_request_status,
                    (p.created_by = $1) AS is_own,
                    u.name AS owner_name
             FROM products p
             LEFT JOIN product_deletion_requests dr
                 ON dr.product_id = p.id AND dr.status = 'pending'
             LEFT JOIN users u ON u.id = p.created_by
             WHERE p.deleted_at IS NULL ${scopeClause}
             ORDER BY p.id DESC`,
            [req.user.userId]
        );

        res.json(result.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get a single product by id
exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            "SELECT * FROM products WHERE id = $1 AND deleted_at IS NULL AND status = 'approved'",
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error fetching product" });
    }
};

// Get all images for a specific product
exports.getProductImages = async (req, res) => {
    try {
        const { id } = req.params;

        const images = await pool.query(
            `SELECT product_images.*, product_colors.name AS color_name FROM product_images
             LEFT JOIN product_colors ON product_images.color_id = product_colors.id
             WHERE product_images.product_id = $1
             ORDER BY COALESCE(product_images.display_order, 999999) ASC, product_images.id ASC`,
            [id]
        );

        res.json(images.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get the global size catalog (master list for admin checkboxes)
exports.getSizeCatalog = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, display_order FROM size_catalog ORDER BY display_order ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get the global color catalog (master list for admin checkboxes)
exports.getColorCatalog = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, display_order FROM color_catalog ORDER BY display_order ASC`
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Save the chosen sizes and colors for a product (replaces existing selections)
exports.saveProductOptions = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const permission = await canEditProduct(req.user, id);
        if (!permission.allowed) {
            return res.status(permission.status).json({ error: permission.error });
        }

        const { sizes, colors, specs } = req.body;

        await client.query("BEGIN");

        const priorVariants = (await client.query(
            `SELECT v.id, pc.name AS color_name, ps.name AS size_name
             FROM product_variants v
             LEFT JOIN product_colors pc ON pc.id = v.color_id
             LEFT JOIN product_sizes ps ON ps.id = v.size_id
             WHERE v.product_id = $1`,
            [id]
        )).rows;

        const sizeIdByName = new Map();
        const colorIdByName = new Map();

        await client.query(`DELETE FROM product_sizes WHERE product_id = $1`, [id]);
        await client.query(`DELETE FROM product_colors WHERE product_id = $1`, [id]);
        await client.query(`DELETE FROM product_specifications WHERE product_id = $1`, [id]);

        if (Array.isArray(sizes)) {
            for (let i = 0; i < sizes.length; i++) {
                const sizeRow = await client.query(
                    `INSERT INTO product_sizes (product_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`,
                    [id, sizes[i], i + 1]
                );
                sizeIdByName.set(String(sizes[i] || "").trim().toLowerCase(), sizeRow.rows[0].id);
            }
        }

        if (Array.isArray(colors)) {
            for (let i = 0; i < colors.length; i++) {
                const imagePaths = Array.isArray(colors[i].image_paths) ? colors[i].image_paths : [];
                const imageIds = Array.isArray(colors[i].image_ids)
                    ? colors[i].image_ids.map(Number).filter(n => Number.isInteger(n))
                    : [];

                // Swatch thumbnail = first assigned photo. The admin form sends
                // image_ids only, so resolve the path from the id rather than
                // falling through to null and blanking the swatch.
                let representativeImage = imagePaths.length > 0
                    ? imagePaths[0]
                    : (colors[i].image_path || null);

                if (!representativeImage && imageIds.length > 0) {
                    const firstImg = await client.query(
                        `SELECT image_path FROM product_images
                         WHERE product_id = $1 AND id = ANY($2::int[])
                         ORDER BY COALESCE(display_order, 999999) ASC, id ASC
                         LIMIT 1`,
                        [id, imageIds]
                    );
                    if (firstImg.rows.length > 0) {
                        representativeImage = firstImg.rows[0].image_path;
                    }
                }

                const rawColorName = String(colors[i].name || '').trim();
                if (!rawColorName) continue;

                // Resolve against the master colour catalogue; create it if new.
                const findCatalog = `SELECT id, name FROM color_catalog WHERE lower(trim(name)) = lower(trim($1))`;
                let catalogRow = (await client.query(findCatalog, [rawColorName])).rows[0];

                if (!catalogRow) {
                    const inserted = await client.query(
                        `INSERT INTO color_catalog (name, display_order)
                         VALUES (trim($1), (SELECT COALESCE(MAX(display_order), 0) + 1 FROM color_catalog))
                         ON CONFLICT DO NOTHING
                         RETURNING id, name`,
                        [rawColorName]
                    );
                    catalogRow = inserted.rows[0]
                        || (await client.query(findCatalog, [rawColorName])).rows[0];
                }

                const catalogId = catalogRow ? catalogRow.id : null;
                const canonicalName = catalogRow ? catalogRow.name : rawColorName;

                const colorResult = await client.query(
                    `INSERT INTO product_colors (product_id, name, image_path, display_order, color_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
                    [id, canonicalName, representativeImage, i + 1, catalogId]
                );
                const newColorId = colorResult.rows[0].id;
                colorIdByName.set(String(canonicalName).trim().toLowerCase(), newColorId);

                if (imageIds.length > 0) {
                    await client.query(
                        `UPDATE product_images SET color_id = $1 WHERE product_id = $2 AND id = ANY($3::int[])`,
                        [newColorId, id, imageIds]
                    );
                }
                for (const [imgIndex, imgPath] of (imageIds.length > 0 ? [] : imagePaths).entries()) {
                    await client.query(
                        `UPDATE product_images SET color_id = $1 WHERE product_id = $2 AND image_path = $3`,
                        [newColorId, id, imgPath]
                    );
                }
            }
        }

        if (Array.isArray(specs)) {
            for (let i = 0; i < specs.length; i++) {
                if (specs[i].label && specs[i].label.trim() !== "") {
                    await client.query(
                        `INSERT INTO product_specifications (product_id, label, value, display_order) VALUES ($1, $2, $3, $4)`,
                        [id, specs[i].label.trim(), specs[i].value || "", i + 1]
                    );
                }
            }
        }

        let variantsRelinked = 0;
        let variantsOrphaned = 0;
        for (const v of priorVariants) {
            const nc = v.color_name ? colorIdByName.get(String(v.color_name).trim().toLowerCase()) : undefined;
            const ns = v.size_name ? sizeIdByName.get(String(v.size_name).trim().toLowerCase()) : undefined;
            if (nc === undefined && ns === undefined) {
                if (v.color_name || v.size_name) variantsOrphaned++;
                continue;
            }
            await client.query(
                `UPDATE product_variants
                 SET color_id = COALESCE($1, color_id), size_id = COALESCE($2, size_id)
                 WHERE id = $3`,
                [nc === undefined ? null : nc, ns === undefined ? null : ns, v.id]
            );
            variantsRelinked++;
        }

        await client.query("COMMIT");
        res.json({ message: "Product options saved", variantsRelinked, variantsOrphaned });

    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (e) { console.error("Rollback failed:", e.message); }
        console.error("saveProductOptions error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// Build the colour x size matrix for a product at zero stock.
// Idempotent: existing pairs are skipped, so it is safe to re-run after
// staff add a new colour or size.
exports.generateProductVariants = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        await client.query("BEGIN");

        const productRow = (await client.query(
            `SELECT id, price FROM products WHERE id = $1 AND deleted_at IS NULL`,
            [id]
        )).rows[0];

        if (!productRow) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Product not found." });
        }

        const colors = (await client.query(
            `SELECT id, name FROM product_colors WHERE product_id = $1 ORDER BY display_order ASC, id ASC`,
            [id]
        )).rows;

        const sizes = (await client.query(
            `SELECT id, name FROM product_sizes WHERE product_id = $1 ORDER BY display_order ASC, id ASC`,
            [id]
        )).rows;

        if (colors.length === 0 || sizes.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "Product needs at least one colour and one size before variants can be generated."
            });
        }

        const existing = new Set(
            (await client.query(
                `SELECT color_id, size_id FROM product_variants WHERE product_id = $1`,
                [id]
            )).rows.map(r => `${r.color_id}:${r.size_id}`)
        );

        let created = 0;
        let skipped = 0;

        for (const color of colors) {
            for (const size of sizes) {
                if (existing.has(`${color.id}:${size.id}`)) {
                    skipped++;
                    continue;
                }
                await client.query(
                    `INSERT INTO product_variants (product_id, variant_name, color_id, size_id, price, stock)
                     VALUES ($1, $2, $3, $4, $5, 0)`,
                    [id, `${color.name} - ${size.name}`, color.id, size.id, productRow.price]
                );
                created++;
            }
        }

        await client.query("COMMIT");

        res.json({
            message: "Variants generated at zero stock. Enter quantities before enabling variant stock.",
            created,
            skipped,
            total: created + skipped
        });

    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (e) { console.error("Rollback failed:", e.message); }
        console.error("generateProductVariants error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// Bulk-update variant stock for one product. Single transaction so the grid
// cannot half-save. Rows not belonging to this product are rejected outright.
exports.updateVariantStock = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const updates = Array.isArray(req.body.updates) ? req.body.updates : [];

        if (updates.length === 0) {
            return res.status(400).json({ error: "No stock updates supplied." });
        }

        const clean = [];
        for (const u of updates) {
            const variantId = Number(u.variant_id);
            const stock = Number(u.stock);
            if (!Number.isInteger(variantId) || !Number.isInteger(stock) || stock < 0) {
                return res.status(400).json({
                    error: "Each update needs an integer variant_id and a stock value of 0 or more."
                });
            }
            clean.push({ variantId, stock });
        }

        await client.query("BEGIN");

        const owned = new Set(
            (await client.query(
                `SELECT id FROM product_variants WHERE product_id = $1`,
                [id]
            )).rows.map(r => r.id)
        );

        const foreign = clean.filter(u => !owned.has(u.variantId));
        if (foreign.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
                error: "Some variants do not belong to this product.",
                variant_ids: foreign.map(u => u.variantId)
            });
        }

        for (const u of clean) {
            await client.query(
                `UPDATE product_variants SET stock = $1 WHERE id = $2 AND product_id = $3`,
                [u.stock, u.variantId, id]
            );
        }

        const totals = (await client.query(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE stock > 0)::int AS in_stock,
                    COALESCE(sum(stock), 0)::int AS total_stock
             FROM product_variants WHERE product_id = $1`,
            [id]
        )).rows[0];

        await client.query("COMMIT");

        res.json({
            message: "Variant stock updated.",
            updated: clean.length,
            total: totals.total,
            in_stock: totals.in_stock,
            total_stock: totals.total_stock
        });

    } catch (error) {
        try { await client.query("ROLLBACK"); } catch (e) { console.error("Rollback failed:", e.message); }
        console.error("updateVariantStock error:", error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// Switch a product between simple stock (products.stock) and per-variant stock.
// Refuses to enable while every variant is zero, which would silently pull the
// product off sale.
exports.setVariantStockMode = async (req, res) => {
    try {
        const { id } = req.params;
        const enabled = req.body.enabled === true;

        if (enabled) {
            const check = (await pool.query(
                `SELECT count(*)::int AS total,
                        count(*) FILTER (WHERE stock > 0)::int AS in_stock
                 FROM product_variants WHERE product_id = $1`,
                [id]
            )).rows[0];

            if (check.total === 0) {
                return res.status(400).json({
                    error: "This product has no variants yet. Generate them first."
                });
            }

            if (check.in_stock === 0) {
                return res.status(400).json({
                    error: "Every variant is out of stock. Enter quantities before enabling variant stock, or the product will not be purchasable."
                });
            }
        }

        const result = await pool.query(
            `UPDATE products SET variant_stock_enabled = $1
             WHERE id = $2 AND deleted_at IS NULL
             RETURNING id, variant_stock_enabled`,
            [enabled, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found." });
        }

        res.json({
            message: enabled ? "Variant stock enabled." : "Reverted to simple product stock.",
            variant_stock_enabled: result.rows[0].variant_stock_enabled
        });

    } catch (error) {
        console.error("setVariantStockMode error:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// Get colors, sizes, and variants for a product
exports.getProductOptions = async (req, res) => {
    try {
        const { id } = req.params;

        const colors = await pool.query(
            `SELECT id, name, image_path, display_order FROM product_colors WHERE product_id = $1 ORDER BY display_order ASC`,
            [id]
        );

        const sizes = await pool.query(
            `SELECT id, name, display_order FROM product_sizes WHERE product_id = $1 ORDER BY display_order ASC`,
            [id]
        );

        const variants = await pool.query(
            `SELECT id, variant_name, color_id, size_id, price, stock FROM product_variants WHERE product_id = $1`,
            [id]
        );

        const specs = await pool.query(
            `SELECT id, label, value, display_order FROM product_specifications WHERE product_id = $1 ORDER BY display_order ASC`,
            [id]
        );

        // Attribute columns double as specs. They are already captured for the
        // Google Shopping feed, so surfacing them saves re-typing the same
        // facts into product_specifications by hand. package_size is excluded
        // deliberately: it is a delivery tier, defaults to 'Small', and would
        // otherwise print a meaningless row on every product. warranty_months
        // is excluded because the page already shows it beside the price.
        const attrRow = await pool.query(
            `SELECT brand, material, color, sleeve, style, length, fit,
                    pattern, occasion, care_instructions, product_weight_kg
             FROM products WHERE id = $1`,
            [id]
        );

        const DERIVED = [
            ["brand", "Brand"],
            ["material", "Material"],
            ["color", "Colour"],
            ["sleeve", "Sleeve"],
            ["style", "Style"],
            ["length", "Length"],
            ["fit", "Fit"],
            ["pattern", "Pattern"],
            ["occasion", "Occasion"],
            ["product_weight_kg", "Weight"],
            ["care_instructions", "Care Instructions"]
        ];

        const merged = specs.rows.slice();
        const taken = new Set(
            merged.map((s) => String(s.label || "").trim().toLowerCase())
        );
        const attrs = attrRow.rows[0] || {};
        let order = merged.length;

        DERIVED.forEach(([col, label]) => {
            const raw = attrs[col];
            if (raw === null || raw === undefined) return;
            const value = String(raw).trim();
            if (value === "") return;
            // A hand-entered spec always wins over the column, so staff can
            // override the derived wording without producing a duplicate row.
            if (taken.has(label.toLowerCase())) return;
            merged.push({
                id: null,
                label: label,
                value: col === "product_weight_kg" ? value + " kg" : value,
                display_order: order++
            });
        });

        res.json({
            colors: colors.rows,
            sizes: sizes.rows,
            variants: variants.rows,
            specs: merged
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update product (optionally add more images)
exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const permission = await canEditProduct(req.user, id);
        if (!permission.allowed) {
            return res.status(permission.status).json({ error: permission.error });
        }

        const { name, category_id, description, price, stock, package_size,
                material, color, sleeve, style, length, fit, pattern, care_instructions, occasion,
                warranty_months, brand, gtin, mpn } = req.body;

        const packageSize = safePackageSize(package_size);
        const warrantyMonths = warranty_months ? Number(warranty_months) : null;

        const uploadedFiles = req.files || [];
        const newImagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );

        const statusClause = req.user.role === "product_staff" ? `, status='pending'` : "";

        let updateQuery = `UPDATE products SET name=$1, category_id=$2, description=$3, price=$4, stock=$5,
            material=$6, color=$7, sleeve=$8, style=$9, length=$10, fit=$11, pattern=$12, care_instructions=$13, occasion=$14,
            package_size=$15, warranty_months=$16,
            brand=$17, gtin=$18, mpn=$19${statusClause}`;
        let params = [name, category_id, description, price, stock,
            material || null, color || null, sleeve || null, style || null, length || null,
            fit || null, pattern || null, care_instructions || null, occasion || null,
            packageSize, warrantyMonths,
            brand || null, gtin || null, mpn || null];

        if (newImagePaths.length > 0) {
            updateQuery += `, image=$20 WHERE id=$21 RETURNING *`;
            params.push(newImagePaths[0], id);
        } else {
            updateQuery += ` WHERE id=$20 RETURNING *`;
            params.push(id);
        }

        const product = await pool.query(updateQuery, params);

        if (product.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }

        const maxRes = await pool.query("SELECT COALESCE(MAX(display_order), -1) AS m FROM product_images WHERE product_id = $1", [id]);
        const startAt = Number(maxRes.rows[0].m) + 1;
        const imageRecords = [];
        for (const [imgIndex, imgPath] of newImagePaths.entries()) {
            const ins = await pool.query(
                `INSERT INTO product_images (product_id, image_path, display_order) VALUES ($1, $2, $3) RETURNING id, image_path`,
                [id, imgPath, startAt + imgIndex]
            );
            imageRecords.push(ins.rows[0]);
        }

        logActivity(req.user.userId, "edited_product", "product", Number(id), `Edited "${name}"`);

        const message = req.user.role === "product_staff"
            ? "Product updated and is pending admin approval."
            : "Product updated successfully";

        res.json({ message, product: product.rows[0], images: newImagePaths, image_records: imageRecords });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a single product image
exports.deleteProductImage = async (req, res) => {
    try {
        const { imageId } = req.params;

        // Only an imageId arrives, so resolve its product before checking rights.
        const owner = await pool.query(
            `SELECT product_id FROM product_images WHERE id = $1`,
            [imageId]
        );
        if (owner.rows.length === 0) {
            return res.status(404).json({ error: "Image not found" });
        }
        const permission = await canEditProduct(req.user, owner.rows[0].product_id);
        if (!permission.allowed) {
            return res.status(permission.status).json({ error: permission.error });
        }

        const client = await pool.connect();
        let deletedRow;
        try {
            await client.query("BEGIN");

            const image = await client.query(
                `DELETE FROM product_images WHERE id=$1 RETURNING *`,
                [imageId]
            );
            if (image.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Image not found" });
            }
            deletedRow = image.rows[0];

            // Close the gap left in display_order.
            const remaining = await client.query(
                `SELECT id FROM product_images WHERE product_id = $1
                 ORDER BY COALESCE(display_order, 999999) ASC, id ASC`,
                [deletedRow.product_id]
            );
            for (let i = 0; i < remaining.rows.length; i++) {
                await client.query(
                    "UPDATE product_images SET display_order = $1 WHERE id = $2",
                    [i, remaining.rows[i].id]
                );
            }

            // Swatch thumbnail pointed at the deleted file: re-derive or null it.
            if (deletedRow.color_id) {
                const next = await client.query(
                    `SELECT image_path FROM product_images
                     WHERE product_id = $1 AND color_id = $2
                     ORDER BY COALESCE(display_order, 999999) ASC, id ASC LIMIT 1`,
                    [deletedRow.product_id, deletedRow.color_id]
                );
                await client.query(
                    "UPDATE product_colors SET image_path = $1 WHERE id = $2",
                    [next.rows[0] ? next.rows[0].image_path : null, deletedRow.color_id]
                );
            }

            await client.query("COMMIT");
        } catch (e) {
            try { await client.query("ROLLBACK"); } catch (e2) {}
            throw e;
        } finally {
            client.release();
        }

        res.json({ message: "Image deleted successfully", deletedId: Number(imageId) });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete product
exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const role = req.user.role;

        if (role === "product_staff") {
            return res.status(403).json({ error: "Product Staff cannot delete products. Ask a Store Manager or Admin." });
        }

        if (role === "store_manager") {
            const existing = await pool.query(
                `SELECT id FROM product_deletion_requests WHERE product_id = $1 AND status = 'pending'`,
                [id]
            );
            if (existing.rows.length > 0) {
                return res.status(409).json({ error: "A deletion request for this product is already pending." });
            }

            await pool.query(
                `INSERT INTO product_deletion_requests (product_id, requested_by) VALUES ($1, $2)`,
                [id, req.user.userId]
            );

            logActivity(req.user.userId, "requested_deletion", "product", Number(id), "Requested product deletion");

            return res.json({ message: "Deletion request submitted. An admin will review it shortly." });
        }

        const product = await pool.query(
            `UPDATE products SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
            [id]
        );

        if (product.rows.length === 0) {
            return res.status(404).json({ error: "Product not found or already deleted." });
        }

        logActivity(req.user.userId, "deleted_product", "product", Number(id), `Moved "${product.rows[0].name}" to Trash`);

        res.json({ message: "Product moved to Trash." });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all categories
exports.getCategories = async (req, res) => {
    try {
        const categories = await pool.query(`SELECT * FROM categories ORDER BY name`);
        res.json(categories.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


// --- Admin approval workflow, trash, and deletion requests ---

exports.getPendingProducts = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, u.name AS submitted_by_name
             FROM products p
             LEFT JOIN users u ON u.id = p.created_by
             WHERE p.status = 'pending' AND p.deleted_at IS NULL
             ORDER BY p.created_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Get pending products error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.approveProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE products SET status = 'approved' WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found." });
        }
        logActivity(req.user.userId, "approved_product", "product", Number(id), `Approved "${result.rows[0].name}"`);
        res.json({ message: "Product approved and is now live.", product: result.rows[0] });
    } catch (error) {
        console.error("Approve product error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.rejectProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE products SET status = 'rejected' WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found." });
        }
        logActivity(req.user.userId, "rejected_product", "product", Number(id), `Rejected "${result.rows[0].name}"`);
        res.json({ message: "Product rejected.", product: result.rows[0] });
    } catch (error) {
        console.error("Reject product error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getDeletionRequests = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT dr.id, dr.product_id, dr.status, dr.requested_at,
                    p.name AS product_name, p.price, p.image,
                    u.name AS requested_by_name
             FROM product_deletion_requests dr
             JOIN products p ON p.id = dr.product_id
             LEFT JOIN users u ON u.id = dr.requested_by
             WHERE dr.status = 'pending'
             ORDER BY dr.requested_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Get deletion requests error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.approveDeletionRequest = async (req, res) => {
    try {
        const { id } = req.params;

        const requestResult = await pool.query(
            `SELECT * FROM product_deletion_requests WHERE id = $1 AND status = 'pending'`,
            [id]
        );
        if (requestResult.rows.length === 0) {
            return res.status(404).json({ error: "Deletion request not found or already reviewed." });
        }
        const deletionRequest = requestResult.rows[0];

        const productResult = await pool.query(
            `UPDATE products SET deleted_at = NOW() WHERE id = $1 RETURNING *`,
            [deletionRequest.product_id]
        );

        await pool.query(
            `UPDATE product_deletion_requests SET status = 'approved', reviewed_at = NOW(), reviewed_by = $1 WHERE id = $2`,
            [req.user.userId, id]
        );

        logActivity(req.user.userId, "approved_deletion", "product", deletionRequest.product_id, `Approved deletion of "${productResult.rows[0] ? productResult.rows[0].name : ""}"`);

        res.json({ message: "Deletion request approved. Product moved to Trash." });
    } catch (error) {
        console.error("Approve deletion request error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.rejectDeletionRequest = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `UPDATE product_deletion_requests SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $1
             WHERE id = $2 AND status = 'pending' RETURNING *`,
            [req.user.userId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Deletion request not found or already reviewed." });
        }

        logActivity(req.user.userId, "rejected_deletion", "product", result.rows[0].product_id, "Rejected deletion request");

        res.json({ message: "Deletion request rejected. Product remains live." });
    } catch (error) {
        console.error("Reject deletion request error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.getTrash = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Get trash error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.restoreProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE products SET deleted_at = NULL WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found." });
        }
        logActivity(req.user.userId, "restored_product", "product", Number(id), `Restored "${result.rows[0].name}" from Trash`);
        res.json({ message: "Product restored.", product: result.rows[0] });
    } catch (error) {
        console.error("Restore product error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

exports.permanentlyDeleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `DELETE FROM products WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Product not found in Trash." });
        }
        logActivity(req.user.userId, "permanently_deleted_product", "product", Number(id), `Permanently deleted "${result.rows[0].name}"`);
        res.json({ message: "Product permanently deleted." });
    } catch (error) {
        if (error.code === "23503") {
            return res.status(409).json({
                error: "This product can't be permanently deleted because it's part of an existing order."
            });
        }
        console.error("Permanent delete error:", error);
        res.status(500).json({ error: "Something went wrong." });
    }
};

// Reorder a product's images. Body: { imageIds: [12, 8, 30, ...] } in desired order.
exports.updateImageOrder = async (req, res) => {
    const { id } = req.params;
    const { imageIds } = req.body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return res.status(400).json({ error: "imageIds must be a non-empty array" });
    }
    const ids = imageIds.map(Number);
    if (ids.some((n) => !Number.isInteger(n))) {
        return res.status(400).json({ error: "imageIds must contain integers only" });
    }

    const client = await pool.connect();
    try {
        const permission = await canEditProduct(req.user, id);
        if (!permission.allowed) {
            client.release();
            return res.status(permission.status).json({ error: permission.error });
        }

        await client.query("BEGIN");

        const owned = await client.query(
            "SELECT id FROM product_images WHERE product_id = $1 AND id = ANY($2::int[])",
            [id, ids]
        );
        if (owned.rows.length !== ids.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "One or more image IDs do not belong to this product" });
        }

        for (let i = 0; i < ids.length; i++) {
            await client.query(
                "UPDATE product_images SET display_order = $1 WHERE id = $2 AND product_id = $3",
                [i, ids[i], id]
            );
        }

        await client.query("COMMIT");
        res.json({ success: true, updated: ids.length });
    } catch (error) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};
