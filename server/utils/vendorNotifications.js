// Pure logic for the vendor notification feed (Task #65). No DB access
// here - see server/controllers/vendorController.js (and the small hooks
// added to checkoutController.js/productController.js) for the
// DB-touching wrapper (createVendorNotification) that inserts the built
// {title, message, linkTab} as one vendor_notifications row.

const NOTIFICATION_TYPES = [
    "new_order", "low_stock", "product_approved", "product_rejected",
    "compliance_action", "payout_update", "refund_decision", "admin_message",
    "kyc_status_change", "consignment_status", "ad_campaign_status"
];

// Matches the `stock < 10` threshold getVendorDashboardSummary already
// uses for its "Low Stock" KPI card - named here so both places refer to
// the same number instead of two separately-typed literals.
const LOW_STOCK_THRESHOLD = 10;

function isValidNotificationType(type) {
    return NOTIFICATION_TYPES.includes(type);
}

// Builds the display copy for one notification from plain context data.
// Returns null for an unknown type so a caller can guard rather than
// insert a blank/garbage row.
function buildNotification(type, context = {}) {
    switch (type) {
        case "new_order":
            return {
                title: "New order received",
                message: `Order #${context.orderId} includes ${context.itemCount} of your item${context.itemCount === 1 ? "" : "s"}.`,
                linkTab: "orders"
            };
        case "low_stock":
            return {
                title: "Low stock",
                message: `${context.productName} is down to ${context.stock} in stock.`,
                linkTab: "products"
            };
        case "product_approved":
            return {
                title: "Product approved",
                message: `${context.productName} is now live on Lizimas Store.`,
                linkTab: "products"
            };
        case "product_rejected":
            return {
                title: "Product rejected",
                message: `${context.productName} was rejected: ${context.reason}`,
                linkTab: "products"
            };
        case "compliance_action":
            return {
                title: context.actionLabel,
                message: context.reason,
                linkTab: "account"
            };
        case "payout_update":
            return {
                title: context.status === "paid" ? "Payout sent" : "Payout rejected",
                message: `Your payout request of UGX ${Number(context.amount).toLocaleString()} was ${context.status}.`,
                linkTab: "wallet"
            };
        case "refund_decision":
            return {
                title: context.decision === "approved" ? "Refund approved" : "Refund denied",
                message: context.decision === "approved"
                    ? `Your refund for ${context.productName} was approved (UGX ${Number(context.amount).toLocaleString()}).`
                    : `Your refund for ${context.productName} was denied${context.notes ? `: ${context.notes}` : "."}`,
                linkTab: "refunds"
            };
        case "admin_message":
            return {
                title: "New reply from Lizimas Store",
                message: context.subject ? `Reply on: ${context.subject}` : "You have a new reply on your message.",
                linkTab: "messages"
            };
        case "kyc_status_change": {
            const labels = {
                submitted: "submitted",
                under_review: "under review",
                action_required: "needs more information",
                verified: "verified",
                rejected: "rejected",
                suspended: "suspended"
            };
            const statusLabel = labels[context.status] || context.status;
            return {
                title: `KYC status: ${statusLabel}`,
                message: context.note
                    ? `Your KYC submission: ${statusLabel}. Note: ${context.note}`
                    : `Your KYC submission: ${statusLabel}.`,
                linkTab: "kyc"
            };
        }
        case "consignment_status": {
            const labels = {
                received: "received in full",
                partially_received: "partially received",
                rejected: "rejected"
            };
            const statusLabel = labels[context.status] || context.status;
            return {
                title: context.status === "rejected" ? "Consignment rejected" : "Consignment received at the hub",
                message: context.status === "rejected"
                    ? (context.note || `Your consignment #${context.consignmentId} was rejected.`)
                    : `Your consignment #${context.consignmentId} was ${statusLabel} at the hub.`,
                linkTab: "products"
            };
        }
        case "ad_campaign_status": {
            const isRejected = context.status === "rejected";
            return {
                title: isRejected ? "Ad campaign rejected" : "Ad campaign approved",
                message: isRejected
                    ? (context.note || `Your campaign "${context.campaignName}" was rejected.`)
                    : `Your campaign "${context.campaignName}" is now live.`,
                linkTab: "account"
            };
        }
        default:
            return null;
    }
}

module.exports = {
    NOTIFICATION_TYPES,
    LOW_STOCK_THRESHOLD,
    isValidNotificationType,
    buildNotification
};
