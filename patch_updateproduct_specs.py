path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = '''exports.updateProduct = async (req, res) => {
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
        }'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category_id, description, price, stock,
                material, color, sleeve, style, length, fit, pattern, care_instructions, occasion } = req.body;

        const uploadedFiles = req.files || [];
        const newImagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );

        const statusClause = req.user.role === "product_staff" ? `, status='pending'` : "";

        let updateQuery = `UPDATE products SET name=$1, category_id=$2, description=$3, price=$4, stock=$5,
            material=$6, color=$7, sleeve=$8, style=$9, length=$10, fit=$11, pattern=$12, care_instructions=$13, occasion=$14${statusClause}`;
        let params = [name, category_id, description, price, stock,
            material || null, color || null, sleeve || null, style || null, length || null,
            fit || null, pattern || null, care_instructions || null, occasion || null];

        if (newImagePaths.length > 0) {
            updateQuery += `, image=$15 WHERE id=$16 RETURNING *`;
            params.push(newImagePaths[0], id);
        } else {
            updateQuery += ` WHERE id=$15 RETURNING *`;
            params.push(id);
        }'''

content = content.replace(old, new)

old2 = "res.json({ message, product: product.rows[0] });"
count2 = content.count(old2)
if count2 != 1:
    print(f"ABORT: expected 1 occurrence of old2, found {count2}")
    exit(1)
content = content.replace(old2, "res.json({ message, product: product.rows[0], images: newImagePaths });")

with open(path, "w") as f:
    f.write(content)

print("DONE_UPDATEPRODUCT_SPECS")
