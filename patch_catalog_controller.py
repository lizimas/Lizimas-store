path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = "// Get colors, sizes, and variants for a product\nexports.getProductOptions = async (req, res) => {"

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''// Get the global size catalog (master list for admin checkboxes)
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
    try {
        const { id } = req.params;
        const { sizes, colors } = req.body;

        await pool.query(`DELETE FROM product_sizes WHERE product_id = $1`, [id]);
        await pool.query(`DELETE FROM product_colors WHERE product_id = $1`, [id]);

        if (Array.isArray(sizes)) {
            for (let i = 0; i < sizes.length; i++) {
                await pool.query(
                    `INSERT INTO product_sizes (product_id, name, display_order) VALUES ($1, $2, $3)`,
                    [id, sizes[i], i + 1]
                );
            }
        }

        if (Array.isArray(colors)) {
            for (let i = 0; i < colors.length; i++) {
                await pool.query(
                    `INSERT INTO product_colors (product_id, name, image_path, display_order) VALUES ($1, $2, $3, $4)`,
                    [id, colors[i].name, colors[i].image_path || null, i + 1]
                );
            }
        }

        res.json({ message: "Product options saved" });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get colors, sizes, and variants for a product
exports.getProductOptions = async (req, res) => {'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: catalog + saveProductOptions controllers added")
