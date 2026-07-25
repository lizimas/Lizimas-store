path = "server/controllers/productController.js"

with open(path, "r") as f:
    content = f.read()

old = '''exports.addProduct = async (req, res) => {
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
        );'''

count = content.count(old)
if count != 1:
    print(f"ABORT: expected 1 occurrence, found {count}")
    exit(1)

new = '''exports.addProduct = async (req, res) => {
    try {
        const { name, category_id, description, price, stock,
                material, color, sleeve, style, length, fit, pattern, care_instructions, occasion } = req.body;

        const status = req.user.role === "product_staff" ? "pending" : "approved";

        const uploadedFiles = req.files || [];
        const imagePaths = await Promise.all(
            uploadedFiles.map(f => uploadBufferToCloudinary(f.buffer))
        );
        const mainImage = imagePaths.length > 0 ? imagePaths[0] : (req.body.image || null);

        const product = await pool.query(
            `INSERT INTO products (name,category_id,description,price,stock,image,status,created_by,
                material,color,sleeve,style,length,fit,pattern,care_instructions,occasion)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
            [name, category_id, description, price, stock, mainImage, status, req.user.userId,
                material || null, color || null, sleeve || null, style || null, length || null,
                fit || null, pattern || null, care_instructions || null, occasion || null]
        );'''

content = content.replace(old, new)

with open(path, "w") as f:
    f.write(content)

print("DONE_ADDPRODUCT_SPECS")
