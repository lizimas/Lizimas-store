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

// Public: list categories with image, ordered for the homepage tile grid
exports.listCategories = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.name, c.description, c.image_url, c.display_order,
                    COUNT(p.id)::int AS product_count
             FROM categories c
             LEFT JOIN products p ON p.category_id = c.id
             GROUP BY c.id
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

        if (!name) {
            return res.status(400).json({ message: "Category name is required" });
        }

        let imageUrl = null;
        if (req.file) {
            imageUrl = await uploadBufferToCloudinary(req.file.buffer);
        }

        const result = await pool.query(
            `INSERT INTO categories (name, description, image_url, display_order)
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, description, image_url, display_order`,
            [name, description, imageUrl, displayOrder]
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

        if (!name) {
            return res.status(400).json({ message: "Category name is required" });
        }

        let imageUrl = current.image_url;
        if (req.file) {
            imageUrl = await uploadBufferToCloudinary(req.file.buffer);
        }

        const result = await pool.query(
            `UPDATE categories
             SET name = $1, description = $2, image_url = $3, display_order = $4
             WHERE id = $5
             RETURNING id, name, description, image_url, display_order`,
            [name, description, imageUrl, displayOrder, id]
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
