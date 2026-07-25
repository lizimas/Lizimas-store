path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = '''        const images = await pool.query(
            `SELECT * FROM product_images WHERE product_id = $1 ORDER BY id ASC`,
            [id]
        );'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        const images = await pool.query(
            `SELECT product_images.* FROM product_images
             LEFT JOIN product_colors ON product_images.color_id = product_colors.id
             WHERE product_images.product_id = $1
             ORDER BY COALESCE(product_colors.display_order, 999999) ASC, product_images.id ASC`,
            [id]
        );'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_GROUPED_QUERY_PATCH")
