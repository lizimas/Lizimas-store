const express = require("express");
const router = express.Router();

const {
    getVariantsByProduct,
    addVariant,
    updateVariant,
    deleteVariant
} = require("../controllers/variantController");

const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: anyone can view variants (storefront needs this)
router.get("/product/:productId", getVariantsByProduct);

// Admin only: add, update, delete (with single image upload per variant)
router.post("/product/:productId", requireAuth, requireAdmin, upload.array("images", 1), addVariant);
router.put("/:variantId", requireAuth, requireAdmin, upload.array("images", 1), updateVariant);
router.delete("/:variantId", requireAuth, requireAdmin, deleteVariant);

module.exports = router;
