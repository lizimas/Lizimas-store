const express = require("express");
const router = express.Router();

const {
    listCategories,
    listAllCategories,
    createCategory,
    updateCategory,
    setCategoryStatus,
    deleteCategory
} = require("../controllers/categoryController");

const {
    listCommissionRules,
    setCategoryCommissionRule,
    setDefaultCommissionRule,
    clearCategoryCommissionRule
} = require("../controllers/commissionController");

const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: storefront tile grid, active categories only
router.get("/", listCategories);

// Admin only: categories are taxonomy, not content
router.get("/manage", requireAuth, requireAdmin, listAllCategories);
router.post("/", requireAuth, requireAdmin, upload.single("image"), createCategory);
router.put("/:id", requireAuth, requireAdmin, upload.single("image"), updateCategory);
router.patch("/:id/status", requireAuth, requireAdmin, setCategoryStatus);

// Hard delete kept as a last resort; refuses while products are linked
router.delete("/:id", requireAuth, requireAdmin, deleteCategory);

// Commission engine (admin only). Category-specific rules take precedence
// over the marketplace-wide default; see commissionController.js for how
// versioning and inheritance work.
router.get("/commission-rules", requireAuth, requireAdmin, listCommissionRules);
router.post("/commission-rules/default", requireAuth, requireAdmin, setDefaultCommissionRule);
router.post("/:id/commission-rule", requireAuth, requireAdmin, setCategoryCommissionRule);
router.delete("/:id/commission-rule", requireAuth, requireAdmin, clearCategoryCommissionRule);

module.exports = router;
