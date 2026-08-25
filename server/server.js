const app = require("./app");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log(`Lizimas Store API running on port ${PORT}`);
});

// Payment reconciler. Polls the provider for payments still in flight and
// feeds the result through the same recordPaymentOutcome() path a webhook
// would, so side effects fire exactly once either way.
//
// Enabled by default. Sandbox sends no callbacks at all, and production drops
// them often enough that this is the only reliable settlement path - a missing
// env var must not silently disable it.
const reconcilerEnabled =
    String(process.env.PAYMENT_RECONCILER_ENABLED || "").toLowerCase() !== "false";

const reconciler = require("./jobs/paymentReconciler");

if (reconcilerEnabled) {
    reconciler.start();
    console.log("Payment reconciler started");
} else {
    console.warn("Payment reconciler DISABLED via PAYMENT_RECONCILER_ENABLED=false");
}

// Stop the timer before the process goes away, so a deploy cannot kill the
// dyno mid-tick and leave a claimed payment row unresolved.
function shutdown(signal) {
    console.log(`${signal} received, shutting down`);
    if (reconcilerEnabled) reconciler.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
