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

// Add product (with optional multiple image uploads)
exports.addProduct = async (req, res) => {
    try {
        const { name, category_id, description, price, stock } = req.body;

        const status = req.user.role === "product_staff" ? "pending" : "approved";

        const uploadedFiles = req.files || [];
        const imagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );
        const mainImage = imagePaths.length > 0 ? imagePaths[0] : (req.body.image || null);

        const product = await pool.query(
            `INSERT INTO products (name,category_id,description,price,stock,image,status,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [name, category_id, description, price, stock, mainImage, status, req.user.userId]
        );

        const newProduct = product.rows[0];

        for (const imgPath of imagePaths) {
            await pool.query(
                `INSERT INTO product_images (product_id, image_path) VALUES ($1, $2)`,
                [newProduct.id, imgPath]
            );
        }

        logActivity(req.user.userId, "added_product", "product", newProduct.id, `Added "${name}" (status: ${status})`);

        const message = status === "pending"
            ? "Product submitted and is pending admin approval."
            : "Product added successfully";

        res.json({ message, product: newProduct });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all products
exports.getProducts = async (req, res) => {
    try {
        const products = await pool.query(
            `SELECT products.*, categories.name AS category
             FROM products
             LEFT JOIN categories ON products.category_id = categories.id
             WHERE products.status = 'approved' AND products.deleted_at IS NULL
             ORDER BY products.id DESC`
        );

        res.json(products.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get a single product by id
exports.getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
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
            `SELECT * FROM product_images WHERE product_id = $1 ORDER BY id ASC`,
            [id]
        );

        res.json(images.rows);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update product (optionally add more images)
exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category_id, description, price, stock } = req.body;

        const uploadedFiles = req.files || [];
        const newImagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );

        const statusClause = req.user.role === "product_staff" ? `, status='pending'` : "";

        let updateQuery = `UPDATE products SET name=$1, category_id=$2, description=$3, price=$4, stock=$5${statusClause}`;
        let params = [name, category_id, description, price, stock];

        if (newImagePaths.length > 0) {
            updateQuery += `, image=$6 WHERE id=$7 RETURNING *`;
            params.push(newImagePaths[0], id);
        } else {
            updateQuery += ` WHERE id=$6 RETURNING *`;
            params.push(id);
        }

        const product = await pool.query(updateQuery, params);

        if (product.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }

        for (const imgPath of newImagePaths) {
            await pool.query(
                `INSERT INTO product_images (product_id, image_path) VALUES ($1, $2)`,
                [id, imgPath]
            );
        }

        logActivity(req.user.userId, "edited_product", "product", Number(id), `Edited "${name}"`);

        const message = req.user.role === "product_staff"
            ? "Product updated and is pending admin approval."
            : "Product updated successfully";

        res.json({ message, product: product.rows[0] });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a single product image
exports.deleteProductImage = async (req, res) => {
    try {
        const { imageId } = req.params;

        const image = await pool.query(
            `DELETE FROM product_images WHERE id=$1 RETURNING *`,
            [imageId]
        );

        if (image.rows.length === 0) {
            return res.status(404).json({ error: "Image not found" });
        }

        res.json({ message: "Image deleted successfully" });

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
