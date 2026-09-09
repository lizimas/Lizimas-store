const express = require("express");
const router = express.Router();

const { registerVendor, vendorLogin } = require("../controllers/authController");
const {
    getMyVendorProfile, getMyVendorOrders, updateMyVendorProfile, getPublicStorefront,
    followVendor, unfollowVendor, getFollowStatus, getVendorDashboardSummary,
    advanceVendorOrderStage
} = require("../controllers/vendorController");
const {
    addProduct,
    updateProduct,
    deleteProduct,
    getMyProducts,
    getProductImages,
    updateImageOrder,
    deleteProductImage
} = require("../controllers/productController");
const {
    getDescriptionBlocks,
    saveDescriptionBlocks,
    uploadBlockImage
} = require("../controllers/descriptionBlockController");
const {
    listActiveDropoffPoints,
    vendorMarkHandedOver,
    getMyReturns
} = require("../controllers/fulfilmentController");

const { previewPricing } = require("../controllers/commissionController");

const { requireAuth, requireVendor } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: a prospective vendor applies, then logs in to check status/manage
// listings once approved. Login itself is unrestricted by status - the
// portal below decides what a pending/rejected vendor is allowed to do.
router.post("/register", registerVendor);
router.post("/login", vendorLogin);

// Public storefront (spec section 17) - a shopper's view of one vendor's
// page and live catalogue. No auth: this must stay reachable by anyone,
// so it is declared before the requireAuth/requireVendor gate below.
router.get("/store/:slug", getPublicStorefront);

// Follow/unfollow a vendor's storefront (spec: "Followers - customers can
// follow, Lizimas owns the system"). Any logged-in user, not just
// customers with a "customer" role and not vendors managing their own
// portal - so this is requireAuth only, declared before the
// requireVendor gate below rather than folded into it.
router.post("/:id/follow", requireAuth, followVendor);
router.delete("/:id/follow", requireAuth, unfollowVendor);
router.get("/:id/follow-status", requireAuth, getFollowStatus);

// Everything below is the vendor's own portal.
router.use(requireAuth, requireVendor);

router.get("/me", getMyVendorProfile);
router.patch("/me", updateMyVendorProfile);
router.get("/orders", getMyVendorOrders);
router.patch("/order-items/:orderItemId/stage", advanceVendorOrderStage);
router.get("/dashboard-summary", getVendorDashboardSummary);

router.get("/products", getMyProducts);
router.post("/products", upload.array("images", 20), addProduct);
router.put("/products/:id", upload.array("images", 20), updateProduct);
router.delete("/products/:id", deleteProduct);
router.get("/products/:id/images", getProductImages);
router.patch("/products/:id/images/order", updateImageOrder);
router.delete("/products/images/:imageId", deleteProductImage);

router.get("/products/:id/description-blocks", getDescriptionBlocks);
router.put("/products/:id/description-blocks", saveDescriptionBlocks);
router.post("/products/:id/description-blocks/image", upload.single("image"), uploadBlockImage);

router.get("/dropoff-points", listActiveDropoffPoints);
router.post("/order-items/:orderItemId/handover", vendorMarkHandedOver);
router.get("/returns", getMyReturns);

// Live pricing preview for the product-upload form (spec section 8): given
// a category and the vendor's desired payout, returns the commission rate,
// Lizimas' cut, and the customer-facing price - before the vendor submits
// anything.
router.post("/pricing/preview", previewPricing);

module.exports = router;
