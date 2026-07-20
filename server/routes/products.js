const express = require("express");
const router = express.Router();

const {
    addProduct,
    getProducts,
    getProductById,
    getProductImages,
    updateProduct,
    deleteProduct,
    deleteProductImage,
    getCategories
} = require("../controllers/productController");

const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: anyone can view products/categories (storefront needs this)
router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/:id/images", getProductImages);
router.get("/:id", getProductById);

// Admin only: add, update, delete (with image uploads, up to 6 photos per product)
router.post("/", requireAuth, requireAdmin, upload.array("images", 20), addProduct);
router.put("/:id", requireAuth, requireAdmin, upload.array("images", 20), updateProduct);
router.delete("/:id", requireAuth, requireAdmin, deleteProduct);
router.delete("/images/:imageId", requireAuth, requireAdmin, deleteProductImage);

module.exports = router;
