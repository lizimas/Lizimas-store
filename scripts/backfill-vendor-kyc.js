// One-time backfill: moves every vendor's existing plaintext
// registration_number/national_id_number (on the legacy vendors table
// columns) into the new encrypted vendor_kyc table (migration
// 079_vendor_kyc.sql), and gives every vendor a starting kyc_status.
//
// Per Ryan's decision (Sept 2026): existing vendors are NOT grandfathered
// as already "verified" under the new system - a vendor who already had
// a number on file gets kyc_status = 'submitted' (their data carries
// over, but it goes through the new review workflow before counting as
// Verified); a vendor with nothing on file gets 'not_started'. This is
// more thorough than auto-verifying everyone, at the cost of every
// current vendor needing an admin KYC review pass once this ships.
//
// Idempotent: ON CONFLICT (vendor_id) DO NOTHING, so running this twice
// (e.g. after adding a vendor between runs) never overwrites a row that
// already exists - including one a vendor has since updated themselves
// through the new /me/kyc endpoint.
//
// Usage (from the repo root, same pattern as scripts/unlock-admin.js):
//   DATABASE_URL="$RENDER_DB" KYC_ENCRYPTION_KEY="<64-char hex>" node scripts/backfill-vendor-kyc.js
//
// KYC_ENCRYPTION_KEY must be the same key the app itself uses (set on
// Render's Environment tab) - generate one with `openssl rand -hex 32`
// if it doesn't exist yet, and set it on Render BEFORE running this,
// since the app can't decrypt what this script encrypts with a
// different key.

const pool = require("../server/config/database");
const { encryptField, hashForLookup } = require("../server/utils/encryption");

async function main() {
    if (!process.env.KYC_ENCRYPTION_KEY) {
        console.error("KYC_ENCRYPTION_KEY is not set. Set the same key the app uses on Render before running this.");
        process.exit(1);
    }

    const { rows: vendors } = await pool.query(
        "SELECT id, registration_number, national_id_number FROM vendors"
    );

    let submitted = 0;
    let notStarted = 0;
    let skipped = 0;

    for (const vendor of vendors) {
        const hasData = Boolean(vendor.registration_number || vendor.national_id_number);
        const status = hasData ? "submitted" : "not_started";

        const natIdEnc = encryptField(vendor.national_id_number);
        const natIdHash = hashForLookup(vendor.national_id_number);
        const regNumEnc = encryptField(vendor.registration_number);
        const regNumHash = hashForLookup(vendor.registration_number);

        const result = await pool.query(
            `INSERT INTO vendor_kyc (vendor_id, kyc_status, national_id_number_enc, national_id_number_hash, registration_number_enc, registration_number_hash)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (vendor_id) DO NOTHING
             RETURNING id`,
            [vendor.id, status, natIdEnc, natIdHash, regNumEnc, regNumHash]
        );

        if (result.rows.length === 0) {
            skipped += 1;
            continue;
        }

        await pool.query(
            `INSERT INTO vendor_kyc_audit_log (vendor_id, from_status, to_status, changed_by, note)
             VALUES ($1, NULL, $2, NULL, 'Backfilled from legacy vendors table (Vendor KYC rework, Sept 2026).')`,
            [vendor.id, status]
        );

        if (status === "submitted") submitted += 1;
        else notStarted += 1;
    }

    console.log(`Backfilled ${vendors.length} vendors: ${submitted} set to 'submitted', ${notStarted} set to 'not_started', ${skipped} already had a vendor_kyc row and were left untouched.`);
    console.log("Next: review each 'submitted' vendor from the admin panel's new Vendor KYC panel and mark them Verified/Action Required/Rejected as appropriate.");

    await pool.end();
}

main().catch((error) => {
    console.error("Backfill failed:", error.message);
    process.exit(1);
});
