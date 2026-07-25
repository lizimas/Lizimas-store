path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old1 = '''        const { sizes, colors } = req.body;

        await pool.query(`DELETE FROM product_sizes WHERE product_id = $1`, [id]);
        await pool.query(`DELETE FROM product_colors WHERE product_id = $1`, [id]);'''

count1 = content.count(old1)
if count1 != 1:
    print(f"ABORT: expected 1 occurrence of old1, found {count1}")
    exit(1)

new1 = '''        const { sizes, colors, specs } = req.body;

        await pool.query(`DELETE FROM product_sizes WHERE product_id = $1`, [id]);
        await pool.query(`DELETE FROM product_colors WHERE product_id = $1`, [id]);
        await pool.query(`DELETE FROM product_specifications WHERE product_id = $1`, [id]);'''

content = content.replace(old1, new1)

old2 = '''        res.json({ message: "Product options saved" });'''
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)

new2 = '''        if (Array.isArray(specs)) {
            for (let i = 0; i < specs.length; i++) {
                if (specs[i].label && specs[i].label.trim() !== "") {
                    await pool.query(
                        `INSERT INTO product_specifications (product_id, label, value, display_order) VALUES ($1, $2, $3, $4)`,
                        [id, specs[i].label.trim(), specs[i].value || "", i + 1]
                    );
                }
            }
        }

        res.json({ message: "Product options saved" });'''

content = content.replace(old2, new2)

with open(path, "w") as f:
    f.write(content)

print("DONE_SPECS_BACKEND_SAVE")
