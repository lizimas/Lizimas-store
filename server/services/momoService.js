const crypto = require("crypto");

const MOMO_BASE_URL = "https://sandbox.momodeveloper.mtn.com";
const TARGET_ENVIRONMENT = process.env.MOMO_ENVIRONMENT || "sandbox";

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiresAt) {
        return cachedToken;
    }

    const subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY;
    const apiUser = process.env.MOMO_API_USER;
    const apiKey = process.env.MOMO_API_KEY;

    const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");

    const response = await fetch(`${MOMO_BASE_URL}/collection/token/`, {
        method: "POST",
        headers: {
            "Ocp-Apim-Subscription-Key": subscriptionKey,
            "Authorization": `Basic ${credentials}`
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get MTN access token: ${errorText}`);
    }

    const data = await response.json();

    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

    return cachedToken;
}

async function requestToPay({ amount, phoneNumber, payerMessage, payeeNote }) {
    const subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY;
    const accessToken = await getAccessToken();
    const referenceId = crypto.randomUUID();

    const response = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-Reference-Id": referenceId,
            "X-Target-Environment": TARGET_ENVIRONMENT,
            "Ocp-Apim-Subscription-Key": subscriptionKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            amount: String(amount),
            currency: "EUR",
            externalId: referenceId,
            payer: {
                partyIdType: "MSISDN",
                partyId: phoneNumber
            },
            payerMessage: payerMessage || "Payment to Lizimas Store",
            payeeNote: payeeNote || "Order payment"
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request to pay failed: ${errorText}`);
    }

    return referenceId;
}

async function checkPaymentStatus(referenceId) {
    const subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY;
    const accessToken = await getAccessToken();

    const response = await fetch(`${MOMO_BASE_URL}/collection/v1_0/requesttopay/${referenceId}`, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "X-Target-Environment": TARGET_ENVIRONMENT,
            "Ocp-Apim-Subscription-Key": subscriptionKey
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to check payment status: ${errorText}`);
    }

    return response.json();
}

module.exports = { getAccessToken, requestToPay, checkPaymentStatus };
