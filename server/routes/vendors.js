const express = require("express");
const router = express.Router();

const { registerVendor, vendorLogin } = require("../controllers/authController");
const { getMyVendorProfile, getMyVendorOrders, updateMyVendorProfile } = require("../controllers/vendorController");
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

const { requireAuth, requireVendor } = require("../middleware/authMiddleware");
const upload = require("../middleware/upload");

// Public: a prospective vendor applies, then logs in to check status/manage
// listings once approved. Login itself is unrestricted by status - the
// portal below decides what a pending/rejected vendor is allowed to do.
router.post("/register", registerVendor);
router.post("/login", vendorLogin);

// Everything below is the vendor's own portal.
router.use(requireAuth, requireVendor);

router.get("/me", getMyVendorProfile);
router.patch("/me", updateMyVendorProfile);
router.get("/orders", getMyVendorOrders);

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

module.exports = router;
