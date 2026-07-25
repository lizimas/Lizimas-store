path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = "// Update product (optionally add more images)\nexports.updateProduct = async (req, res) => {"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''// Get colors, sizes, and variants for a product
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
            `SELECT id, color_id, size_id, price, stock FROM product_variants WHERE product_id = $1`,
            [id]
        );

        res.json({
            colors: colors.rows,
            sizes: sizes.rows,
            variants: variants.rows
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update product (optionally add more images)
exports.updateProduct = async (req, res) => {'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: getProductOptions controller added")
