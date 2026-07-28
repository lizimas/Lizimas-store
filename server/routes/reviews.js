const express = require("express");
const router = express.Router();

const {
    getProductReviews,
    upsertReview,
    deleteReview
} = require("../controllers/reviewController");

const { requireAuth } = require("../middleware/authMiddleware");

router.get("/product/:id", getProductReviews);
router.post("/product/:id", requireAuth, upsertReview);
router.delete("/:reviewId", requireAuth, deleteReview);

module.exports = router;
