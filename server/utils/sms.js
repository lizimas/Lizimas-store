let africastalkingClient = null;
let smsService = null;

function getSmsService() {
    if (!process.env.AT_USERNAME || !process.env.AT_API_KEY) {
        return null;
    }

    if (!smsService) {
        africastalkingClient = require("africastalking")({
            username: process.env.AT_USERNAME,
            apiKey: process.env.AT_API_KEY
        });
        smsService = africastalkingClient.SMS;
    }

    return smsService;
}

/**
 * Sends an SMS to a Ugandan phone number.
 * @param {string} to - phone number in international format, e.g. +2567XXXXXXXX
 * @param {string} message - message body
 */
async function sendSms(to, message) {
    const service = getSmsService();

    if (!service) {
        console.warn("Africa's Talking credentials not set - skipping SMS send.");
        return;
    }

    try {
        const result = await service.send({
            to: [to],
            message: message
        });
        console.log("SMS sent:", JSON.stringify(result));
        return result;
    } catch (error) {
        console.error("SMS send error:", error);
        // Don't throw - a failed SMS should never block an order or status update
    }
}

const ORDER_STATUS_SMS_MESSAGES = {
    pending: "We've received your order and it's being reviewed.",
    paid: "Payment confirmed! We're preparing your order.",
    shipped: "Your order is on its way!",
    delivered: "Your order has been delivered. Thank you for shopping with Lizimas Store!",
    cancelled: "Your order has been cancelled. Contact us if you have questions."
};

/**
 * Sends an order status update SMS.
 * @param {string} phone - phone number in international format, e.g. +2567XXXXXXXX
 * @param {object} order - order row (needs id)
 * @param {string} status - one of pending/paid/shipped/delivered/cancelled
 */
async function sendOrderStatusSms(phone, order, status) {
    if (!phone) return;

    const statusMessage = ORDER_STATUS_SMS_MESSAGES[status] || `Order status: ${status}`;
    const message = `Lizimas Store - Order #${order.id}: ${statusMessage}`;

    return sendSms(phone, message);
}

module.exports = { sendSms, sendOrderStatusSms };
