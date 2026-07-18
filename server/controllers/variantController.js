const pool = require("../config/database");

// Get all variants for a product
exports.getVariantsByProduct = async (req, res) => {
    try {
        const { productId } = req.params;
        const result = await pool.query(
            "SELECT * FROM product_variants WHERE product_id = $1 ORDER BY id ASC",
            [productId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

// Add a variant to a product
exports.addVariant = async (req, res) => {
    try {
        const { productId } = req.params;
        const { variant_name, price, stock } = req.body;

        const uploadedFiles = req.files || [];
        const imagePath = uploadedFiles.length > 0
            ? `uploads/products/${uploadedFiles[0].filename}`
            : null;

        const result = await pool.query(
            `INSERT INTO product_variants (product_id, variant_name, price, stock, image_path)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [productId, variant_name, price, stock || 0, imagePath]
        );

        res.json({ message: "Variant added successfully", variant: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

// Update a variant
exports.updateVariant = async (req, res) => {
    try {
        const { variantId } = req.params;
        const { variant_name, price, stock } = req.body;

        const uploadedFiles = req.files || [];
        const newImagePath = uploadedFiles.length > 0
            ? `uploads/products/${uploadedFiles[0].filename}`
            : null;

        let query = `UPDATE product_variants SET variant_name=$1, price=$2, stock=$3`;
        let params = [variant_name, price, stock || 0];

        if (newImagePath) {
            query += `, image_path=$4 WHERE id=$5 RETURNING *`;
            params.push(newImagePath, variantId);
        } else {
            query += ` WHERE id=$4 RETURNING *`;
            params.push(variantId);
        }

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Variant not found" });
        }

        res.json({ message: "Variant updated successfully", variant: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

// Delete a variant
exports.deleteVariant = async (req, res) => {
    try {
        const { variantId } = req.params;
        const result = await pool.query(
            "DELETE FROM product_variants WHERE id=$1 RETURNING *",
            [variantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Variant not found" });
        }

        res.json({ message: "Variant deleted successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};
