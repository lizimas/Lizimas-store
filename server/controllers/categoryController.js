const pool = require("../config/database");
const cloudinary = require("../config/cloudinary");
const { logActivity } = require("../utils/activityLog");

// Upload a single file buffer to Cloudinary, returns the secure URL
function uploadBufferToCloudinary(fileBuffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: "lizimas-store/categories" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result.secure_url);
            }
        );
        stream.end(fileBuffer);
    });
}

const MAX_DEPTH = 3;

// Returns 1 for a top-level category, 2 for its child, 3 for a grandchild.
// Null id means "no parent", i.e. a new top-level category.
async function categoryDepth(id) {
    let depth = 0;
    let current = id;

    while (current) {
        const row = await pool.query("SELECT parent_id FROM categories WHERE id = $1", [current]);
        if (row.rows.length === 0) return null;   // does not exist
        depth += 1;
        current = row.rows[0].parent_id;
        if (depth > MAX_DEPTH) break;             // guard against a cycle
    }

    return depth;
}

// Public: list categories with image, ordered for the homepage tile grid
exports.listCategories = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.description, c.image_url, COALESCE(c.image_url, pa.image_url) AS effective_image, c.display_order, c.is_active, c.parent_id,
                    COUNT(p.id)::int AS product_count
             FROM categories c
             LEFT JOIN categories pa ON pa.id = c.parent_id
             LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL
             WHERE c.is_active = true
             GROUP BY c.id, pa.image_url
             ORDER BY c.display_order ASC, c.id ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List categories error:", error);
        res.status(500).json({ message: "Failed to load categories" });
    }
};

// Create a category, with optional image upload
exports.createCategory = async (req, res) => {
    try {
        const name = (req.body.name || "").trim();
        const description = (req.body.description || "").trim() || null;
        const displayOrder = parseInt(req.body.display_order, 10) || 0;
        const parentId = req.body.parent_id ? parseInt(req.body.parent_id, 10) : null;

        if (!name) {
            return res.status(400).json({ message: "Category name is required" });
        }

        // Three levels maximum: grandparent > parent > child. Products live on
        // the deepest level, so a new category under a level-3 parent is rejected.
        if (parentId) {
            const parentDepth = await categoryDepth(parentId);
            if (parentDepth === null) {
                return res.status(400).json({ message: "That parent category does not exist" });
            }
            if (parentDepth >= MAX_DEPTH) {
                return res.status(400).json({ message: `Categories only nest ${MAX_DEPTH} levels deep.` });
            }
        }

        let imageUrl = null;
        if (req.file) {
            imageUrl = await uploadBufferToCloudinary(req.file.buffer);
        }

        const result = await pool.query(
            `INSERT INTO categories (name, description, image_url, display_order, parent_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, description, image_url, display_order, is_active, parent_id`,
            [name, description, imageUrl, displayOrder, parentId]
        );

        await logActivity(req.user.id, "create_category", "category", result.rows[0].id, `Created category "${name}"`);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ message: "A category with that name already exists" });
        }
        console.error("Create category error:", error);
        res.status(500).json({ message: "Failed to create category" });
    }
};

// Update a category. Image only replaced when a new file is sent.
exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query("SELECT * FROM categories WHERE id = $1", [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: "Category not found" });
        }
        const current = existing.rows[0];

        const name = req.body.name !== undefined ? (req.body.name || "").trim() : current.name;
        const description = req.body.description !== undefined
            ? ((req.body.description || "").trim() || null)
            : current.description;
        const displayOrder = req.body.display_order !== undefined
            ? (parseInt(req.body.display_order, 10) || 0)
            : current.display_order;
        const parentId = req.body.parent_id !== undefined
            ? (req.body.parent_id ? parseInt(req.body.parent_id, 10) : null)
            : current.parent_id;

        if (!name) {
            return res.status(400).json({ message: "Category name is required" });
        }

        if (parentId !== null) {
            if (parentId === parseInt(id, 10)) {
                return res.status(400).json({ message: "A category cannot be its own parent" });
            }

            const parentDepth = await categoryDepth(parentId);
            if (parentDepth === null) {
                return res.status(400).json({ message: "That parent category does not exist" });
            }

            // Moving into your own descendant would orphan the subtree in a cycle.
            const descendants = await pool.query(
                `WITH RECURSIVE tree AS (
                     SELECT id FROM categories WHERE parent_id = $1
                     UNION ALL
                     SELECT c.id FROM categories c JOIN tree t ON c.parent_id = t.id
                 ) SELECT id FROM tree`,
                [id]
            );
            if (descendants.rows.some(r => r.id === parentId)) {
                return res.status(400).json({ message: "Cannot move a category inside one of its own subcategories" });
            }

            // Moving carries the subtree along, so check the deepest resulting level.
            const subtreeDepth = await pool.query(
                `WITH RECURSIVE tree AS (
                     SELECT id, 1 AS depth FROM categories WHERE id = $1
                     UNION ALL
                     SELECT c.id, t.depth + 1 FROM categories c JOIN tree t ON c.parent_id = t.id
                 ) SELECT MAX(depth)::int AS max_depth FROM tree`,
                [id]
            );
            const ownDepth = subtreeDepth.rows[0].max_depth || 1;

            if (parentDepth + ownDepth > MAX_DEPTH) {
                return res.status(400).json({
                    message: `Cannot move this here: it would nest more than ${MAX_DEPTH} levels deep.`
                });
            }
        }

        let imageUrl = current.image_url;
        if (req.file) {
            imageUrl = await uploadBufferToCloudinary(req.file.buffer);
        }

        const result = await pool.query(
            `UPDATE categories
             SET name = $1, description = $2, image_url = $3, display_order = $4, parent_id = $5
             WHERE id = $6
             RETURNING id, name, description, image_url, display_order, is_active, parent_id`,
            [name, description, imageUrl, displayOrder, parentId, id]
        );

        await logActivity(req.user.id, "update_category", "category", id, `Updated category "${name}"`);
        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ message: "A category with that name already exists" });
        }
        console.error("Update category error:", error);
        res.status(500).json({ message: "Failed to update category" });
    }
};

// Delete a category, refusing while products still reference it
exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query("SELECT name FROM categories WHERE id = $1", [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ message: "Category not found" });
        }

        const inUse = await pool.query(
            "SELECT COUNT(*)::int AS count FROM products WHERE category_id = $1",
            [id]
        );
        if (inUse.rows[0].count > 0) {
            return res.status(409).json({
                message: `Cannot delete: ${inUse.rows[0].count} product(s) still use this category. Reassign them first.`
            });
        }

        await pool.query("DELETE FROM categories WHERE id = $1", [id]);
        await logActivity(req.user.id, "delete_category", "category", id, `Deleted category "${existing.rows[0].name}"`);
        res.json({ message: "Category deleted" });
    } catch (error) {
        console.error("Delete category error:", error);
        res.status(500).json({ message: "Failed to delete category" });
    }
};

// Admin: full list including hidden categories
exports.listAllCategories = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.description, c.image_url, COALESCE(c.image_url, pa.image_url) AS effective_image, c.display_order, c.is_active, c.parent_id,
                    COUNT(p.id)::int AS product_count
             FROM categories c
             LEFT JOIN categories pa ON pa.id = c.parent_id
             LEFT JOIN products p ON p.category_id = c.id AND p.deleted_at IS NULL
             GROUP BY c.id, pa.image_url
             ORDER BY c.display_order ASC, c.id ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("List all categories error:", error);
        res.status(500).json({ message: "Failed to load categories" });
    }
};

// Admin: hide or restore a category without losing product links
exports.setCategoryStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const isActive = req.body.is_active === true || req.body.is_active === "true";

        const result = await pool.query(
            `UPDATE categories SET is_active = $1 WHERE id = $2
             RETURNING id, name, is_active`,
            [isActive, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Category not found" });
        }

        const row = result.rows[0];
        await logActivity(
            req.user.id,
            isActive ? "restore_category" : "hide_category",
            "category", id,
            `${isActive ? "Restored" : "Hid"} category "${row.name}"`
        );
        res.json(row);
    } catch (error) {
        console.error("Set category status error:", error);
        res.status(500).json({ message: "Failed to update category status" });
    }
};
