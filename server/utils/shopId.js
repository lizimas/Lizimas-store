// Shop ID (Jumia Vendor Center comparison, September 2026) - Jumia assigns
// every seller account a short public "Shop ID" (Ryan's own real Jumia
// account is UG140DI) shown on the seller's own profile and used for
// support-ticket/reference lookups. Lizimas had no equivalent - this
// generates one in the same shape: 'UG' + a sequential number (from
// vendor_shop_id_seq, migration 113) padded to at least 3 digits + 2 random
// uppercase letters. The sequence alone already guarantees uniqueness
// across concurrent approvals; the letters are cosmetic, matching Jumia's
// visual format rather than adding real entropy.
const pool = require("../config/database");

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomLetters(n) {
    let out = "";
    for (let i = 0; i < n; i++) {
        out += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    return out;
}

// Pass a `client` (from pool.connect()) to run inside an existing
// transaction; omitting it runs a standalone query against the pool.
async function generateShopId(client) {
    const runner = client || pool;
    const { rows } = await runner.query("SELECT nextval('vendor_shop_id_seq') AS n");
    const n = String(rows[0].n).padStart(3, "0");
    return `UG${n}${randomLetters(2)}`;
}

module.exports = { generateShopId };
