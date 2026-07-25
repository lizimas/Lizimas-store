path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = '''        const variants = await pool.query(
            `SELECT id, color_id, size_id, price, stock FROM product_variants WHERE product_id = $1`,
            [id]
        );

        res.json({
            colors: colors.rows,
            sizes: sizes.rows,
            variants: variants.rows
        });'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        const variants = await pool.query(
            `SELECT id, color_id, size_id, price, stock FROM product_variants WHERE product_id = $1`,
            [id]
        );

        const specs = await pool.query(
            `SELECT id, label, value, display_order FROM product_specifications WHERE product_id = $1 ORDER BY display_order ASC`,
            [id]
        );

        res.json({
            colors: colors.rows,
            sizes: sizes.rows,
            variants: variants.rows,
            specs: specs.rows
        });'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_SPECS_GET_OPTIONS")
