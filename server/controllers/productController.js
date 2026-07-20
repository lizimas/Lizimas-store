const pool = require("../config/database");
const cloudinary = require("../config/cloudinary");

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

        const uploadedFiles = req.files || [];
        const imagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );
        const mainImage = imagePaths.length > 0 ? imagePaths[0] : (req.body.image || null);

        const product = await pool.query(
            `INSERT INTO products (name,category_id,description,price,stock,image)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
            [name, category_id, description, price, stock, mainImage]
        );

        const newProduct = product.rows[0];

        for (const imgPath of imagePaths) {
            await pool.query(
                `INSERT INTO product_images (product_id, image_path) VALUES ($1, $2)`,
                [newProduct.id, imgPath]
            );
        }

        res.json({ message: "Product added successfully", product: newProduct });

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

        let updateQuery = `UPDATE products SET name=$1, category_id=$2, description=$3, price=$4, stock=$5`;
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

        res.json({ message: "Product updated successfully", product: product.rows[0] });

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

        const product = await pool.query(
            `DELETE FROM products WHERE id=$1 RETURNING *`,
            [id]
        );

        if (product.rows.length === 0) {
            return res.status(404).json({ error: "Product not found" });
        }

        res.json({ message: "Product deleted successfully" });

    } catch (error) {
        if (error.code === "23503") {
            return res.status(409).json({
                error: "This product can't be deleted because it's part of an existing order. Consider setting its stock to 0 instead to hide it from customers."
            });
        }
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
