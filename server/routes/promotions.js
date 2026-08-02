const express = require("express");
const router = express.Router();

const {
    listPromotions,
    listAllPromotions,
    createPromotion,
    updatePromotion,
    setPromotionStatus,
    deletePromotion
} = require("../controllers/promotionController");

const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: homepage carousels
router.get("/", listPromotions);

// Admin only
router.get("/manage", requireAuth, requireAdmin, listAllPromotions);
router.post("/", requireAuth, requireAdmin, upload.single("image"), createPromotion);
router.put("/:id", requireAuth, requireAdmin, upload.single("image"), updatePromotion);
router.patch("/:id/status", requireAuth, requireAdmin, setPromotionStatus);
router.delete("/:id", requireAuth, requireAdmin, deletePromotion);

module.exports = router;
