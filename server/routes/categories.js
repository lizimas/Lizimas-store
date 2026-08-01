const express = require("express");
const router = express.Router();

const {
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory
} = require("../controllers/categoryController");

const { requireAuth, requireStaffOrAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: storefront tile grid needs this
router.get("/", listCategories);

// Staff/admin only
router.post("/", requireAuth, requireStaffOrAdmin, upload.single("image"), createCategory);
router.put("/:id", requireAuth, requireStaffOrAdmin, upload.single("image"), updateCategory);
router.delete("/:id", requireAuth, requireStaffOrAdmin, deleteCategory);

module.exports = router;
