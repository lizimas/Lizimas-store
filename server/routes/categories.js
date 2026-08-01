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

module.exports = router;
