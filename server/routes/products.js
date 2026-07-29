const express = require("express");
const router = express.Router();

const {
    addProduct,
    getProducts,
    getProductById,
    getProductImages,
    updateImageOrder,
    getProductOptions,
    getSizeCatalog,
    getColorCatalog,
    saveProductOptions,
    updateProduct,
    deleteProduct,
    deleteProductImage,
    getCategories,
    getMyProducts
} = require("../controllers/productController");

const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: anyone can view products/categories (storefront needs this)
router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/mine", requireAuth, requireStaffOrAdmin, getMyProducts);
router.get("/:id/images", getProductImages);
router.get("/:id/options", getProductOptions);
router.get("/catalog/sizes", getSizeCatalog);
router.get("/catalog/colors", getColorCatalog);
router.post("/:id/options", requireAuth, requireStaffOrAdmin, saveProductOptions);
router.get("/:id", getProductById);

// Admin only: add, update, delete (with image uploads, up to 6 photos per product)
router.post("/", requireAuth, requireStaffOrAdmin, upload.array("images", 20), addProduct);
router.put("/:id", requireAuth, requireStaffOrAdmin, upload.array("images", 20), updateProduct);
router.delete("/:id", requireAuth, requireStaffOrAdmin, deleteProduct);
router.patch("/:id/images/order", requireAuth, requireStaffOrAdmin, updateImageOrder);
router.delete("/images/:imageId", requireAuth, requireStaffOrAdmin, deleteProductImage);

module.exports = router;
