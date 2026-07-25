path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = '''        if (Array.isArray(colors)) {
            for (let i = 0; i < colors.length; i++) {
                await pool.query(
                    `INSERT INTO product_colors (product_id, name, image_path, display_order) VALUES ($1, $2, $3, $4)`,
                    [id, colors[i].name, colors[i].image_path || null, i + 1]
                );
            }
        }'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''        if (Array.isArray(colors)) {
            for (let i = 0; i < colors.length; i++) {
                const imagePaths = Array.isArray(colors[i].image_paths) ? colors[i].image_paths : [];
                const representativeImage = imagePaths.length > 0 ? imagePaths[0] : (colors[i].image_path || null);

                const colorResult = await pool.query(
                    `INSERT INTO product_colors (product_id, name, image_path, display_order) VALUES ($1, $2, $3, $4) RETURNING id`,
                    [id, colors[i].name, representativeImage, i + 1]
                );
                const newColorId = colorResult.rows[0].id;

                for (const imgPath of imagePaths) {
                    await pool.query(
                        `UPDATE product_images SET color_id = $1 WHERE product_id = $2 AND image_path = $3`,
                        [newColorId, id, imgPath]
                    );
                }
            }
        }'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("SUCCESS: saveProductOptions now tags images by color")
