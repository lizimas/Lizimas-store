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
    getMyProducts,
    generateProductVariants,
    setVariantStockMode,
    updateVariantStock
} = require("../controllers/productController");

const {
    getDescriptionBlocks,
    saveDescriptionBlocks,
    uploadBlockImage
} = require("../controllers/descriptionBlockController");

const { requireAuth, requireAdmin, requireStaffOrAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: anyone can view products/categories (storefront needs this)
// Staging upload for the Add Product form, where no product id exists yet.
// Must stay above every "/:id/..." route or Express matches it as an id.
router.post(
    "/description-blocks/image",
    requireAuth,
    requireStaffOrAdmin,
    upload.single("image"),
    uploadBlockImage
);

router.get("/", getProducts);
router.get("/categories", getCategories);
router.get("/mine", requireAuth, requireStaffOrAdmin, getMyProducts);
router.get("/:id/images", getProductImages);
router.get("/:id/options", getProductOptions);
router.get("/:id/description-blocks", getDescriptionBlocks);
router.put("/:id/description-blocks", requireAuth, requireStaffOrAdmin, saveDescriptionBlocks);
router.post("/:id/description-blocks/image", requireAuth, requireStaffOrAdmin, upload.single("image"), uploadBlockImage);
router.get("/catalog/sizes", getSizeCatalog);
router.get("/catalog/colors", getColorCatalog);
router.post("/:id/options", requireAuth, requireStaffOrAdmin, saveProductOptions);

// Variant stock mode: build the colour x size matrix, then switch the product
// over once staff have entered real quantities.
router.post("/:id/variants/generate", requireAuth, requireAdmin, generateProductVariants);
router.patch("/:id/variant-stock", requireAuth, requireAdmin, setVariantStockMode);
router.patch("/:id/variants/stock", requireAuth, requireAdmin, updateVariantStock);
router.get("/:id", getProductById);

// Admin only: add, update, delete (with image uploads, up to 6 photos per product)
router.post("/", requireAuth, requireStaffOrAdmin, upload.array("images", 20), addProduct);
router.put("/:id", requireAuth, requireStaffOrAdmin, upload.array("images", 20), updateProduct);
router.delete("/:id", requireAuth, requireStaffOrAdmin, deleteProduct);
router.patch("/:id/images/order", requireAuth, requireStaffOrAdmin, updateImageOrder);
router.delete("/images/:imageId", requireAuth, requireAdmin, deleteProductImage);

module.exports = router;
