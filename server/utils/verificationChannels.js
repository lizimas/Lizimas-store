/*
 * server/utils/verificationChannels.js
 * Lizimas Store - one interface, three senders.
 *
 * Verification codes go out over email, SMS or WhatsApp. Which of those
 * actually works depends only on which credentials are configured, so
 * controllers ask this module what is available rather than hardcoding
 * a sender. Adding WhatsApp later touches this file and nothing else.
 *
 * The important rule here: a channel that cannot send must SAY so.
 * utils/sms.js currently logs a warning and returns normally when
 * Africa's Talking credentials are missing, which is fine for order
 * notifications but wrong for anything a customer sits waiting on --
 * they would be told a code was sent when none was. Every send() below
 * throws on failure, and isConfigured() is checked before offering a
 * channel in the first place.
 */

const { sendSms } = require("./sms");
const mailer = require("./mailer");

/* ------------------------------------------------------------------ */
/* Phone normalisation                                                 */
/* ------------------------------------------------------------------ */

/*
 * Ugandan numbers arrive as 0772..., 256772..., +256772... or with
 * spaces. Everything is stored and sent as +256XXXXXXXXX so that rate
 * limits and uniqueness cannot be dodged by reformatting the same
 * number three different ways.
 */
function normalisePhone(raw) {
    if (!raw) return null;

    var digits = String(raw).replace(/[^\d+]/g, "");

    if (digits.indexOf("+") === 0) {
        digits = digits.slice(1);
    }

    if (digits.indexOf("00") === 0) {
        digits = digits.slice(2);
    }

    // 0772123456 -> 256772123456
    if (digits.length === 10 && digits.indexOf("0") === 0) {
        digits = "256" + digits.slice(1);
    }

    // 772123456 -> 256772123456
    if (digits.length === 9 && digits.indexOf("0") !== 0) {
        digits = "256" + digits;
    }

    if (!/^256\d{9}$/.test(digits)) {
        return null;
    }

    return "+" + digits;
}

function isValidEmail(value) {
    return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

const channels = {

    email: {
        name: "email",
        label: "Email",

        isConfigured: function () {
            // The mailer is configured at require time from env; if the
            // transporter were absent the export would still exist, so
            // treat presence of the send function as the signal.
            return typeof mailer.sendTwoFactorCodeEmail === "function";
        },

        normalise: function (target) {
            return isValidEmail(target) ? String(target).trim().toLowerCase() : null;
        },

        send: async function (target, code) {
            // TODO: replace with a dedicated sendVerificationCodeEmail
            // once added to mailer.js. sendTwoFactorCodeEmail delivers
            // the same six-digit code with near-identical wording, so
            // this works today rather than blocking on a copy change.
            await mailer.sendTwoFactorCodeEmail(target, code);
        }
    },

    sms: {
        name: "sms",
        label: "SMS",

        isConfigured: function () {
            return Boolean(process.env.AT_USERNAME && process.env.AT_API_KEY);
        },

        normalise: normalisePhone,

        send: async function (target, code) {
            if (!this.isConfigured()) {
                throw new Error("SMS channel is not configured.");
            }

            const message =
                code + " is your Lizimas Store verification code. " +
                "It expires in 10 minutes. Do not share it with anyone.";

            const result = await sendSms(target, message);

            // sendSms resolves undefined when it skips, so an absent
            // result means nothing left the building.
            if (!result) {
                throw new Error("SMS send did not complete.");
            }
        }
    },

    whatsapp: {
        name: "whatsapp",
        label: "WhatsApp",

        isConfigured: function () {
            return Boolean(
                process.env.WA_PHONE_NUMBER_ID &&
                process.env.WA_ACCESS_TOKEN &&
                process.env.WA_OTP_TEMPLATE
            );
        },

        normalise: normalisePhone,

        send: async function (target, code) {
            if (!this.isConfigured()) {
                throw new Error("WhatsApp channel is not configured.");
            }

            const version = process.env.WA_API_VERSION || "v21.0";
            const url = "https://graph.facebook.com/" + version + "/" +
                        process.env.WA_PHONE_NUMBER_ID + "/messages";

            /*
             * Meta requires a pre-approved AUTHENTICATION template --
             * freeform OTP messages get the business account suspended.
             * The code appears twice by design: once as the body
             * variable and again as the copy-code button parameter.
             * Meta's API rejects the message if they disagree.
             */
            const payload = {
                messaging_product: "whatsapp",
                to: target.replace(/^\+/, ""),
                type: "template",
                template: {
                    name: process.env.WA_OTP_TEMPLATE,
                    language: { code: process.env.WA_TEMPLATE_LANG || "en" },
                    components: [
                        {
                            type: "body",
                            parameters: [{ type: "text", text: String(code) }]
                        },
                        {
                            type: "button",
                            sub_type: "url",
                            index: "0",
                            parameters: [{ type: "text", text: String(code) }]
                        }
                    ]
                }
            };

            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": "Bearer " + process.env.WA_ACCESS_TOKEN,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let detail = "";
                try {
                    detail = JSON.stringify(await response.json());
                } catch (err) {
                    detail = "status " + response.status;
                }
                throw new Error("WhatsApp send failed: " + detail);
            }
        }
    }
};

/* ------------------------------------------------------------------ */
/* Public surface                                                      */
/* ------------------------------------------------------------------ */

function getChannel(name) {
    return channels[name] || null;
}

/*
 * What can actually be offered right now. The checkout UI should render
 * from this rather than a fixed list, so a channel appears the moment
 * its credentials land and never before.
 */
function availableChannels() {
    return Object.keys(channels)
        .filter(function (key) { return channels[key].isConfigured(); })
        .map(function (key) {
            return { name: key, label: channels[key].label };
        });
}

function isAvailable(name) {
    const channel = getChannel(name);
    return Boolean(channel && channel.isConfigured());
}

/*
 * Normalise and validate a target for a channel without sending.
 * Returns null if the target is not usable, so callers can reject
 * before generating or storing a code.
 */
function normaliseTarget(name, target) {
    const channel = getChannel(name);
    if (!channel) return null;
    return channel.normalise(target);
}

/*
 * Send a code. Throws if the channel is unknown, unconfigured, the
 * target is unusable, or the send fails. Never resolves quietly.
 */
async function sendCode(name, target, code) {
    const channel = getChannel(name);

    if (!channel) {
        throw new Error("Unknown verification channel: " + name);
    }

    if (!channel.isConfigured()) {
        throw new Error(channel.label + " is not available.");
    }

    const clean = channel.normalise(target);
    if (!clean) {
        throw new Error("Invalid " + channel.label + " target.");
    }

    await channel.send(clean, code);
    return clean;
}

module.exports = {
    availableChannels,
    isAvailable,
    normaliseTarget,
    normalisePhone,
    isValidEmail,
    sendCode
};
