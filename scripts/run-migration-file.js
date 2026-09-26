// One-off migration runner for when psql isn't installed locally.
// Reads a .sql file and executes it as one round-trip -- Postgres's
// simple query protocol (what pg's Pool.query() uses when called with no
// parameters) natively supports multiple semicolon-separated statements
// in one request, so the file's own BEGIN...COMMIT wrapper still governs
// the whole thing atomically, exactly as if psql had run it.
//
// Reuses server/config/database.js's own pool rather than opening a new
// connection with guessed-at SSL options, so this connects exactly the
// way the real app does.
//
// Usage:
//   DATABASE_URL="$RENDER_DB" node scripts/run-migration-file.js migrations/122_vendor_kyc_parity.sql

const fs = require("fs");
const path = require("path");
const pool = require("../server/config/database");

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: DATABASE_URL=... node scripts/run-migration-file.js <path-to-migration.sql>");
        process.exit(1);
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
        console.error(`File not found: ${resolved}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(resolved, "utf8");

    try {
        console.log(`Applying ${path.basename(resolved)}...`);
        await pool.query(sql);
        console.log("Done. (The file's own BEGIN/COMMIT governed atomicity -- if you see this, it committed.)");
    } catch (error) {
        console.error("Migration failed -- the file's BEGIN/COMMIT means nothing partial was left behind:");
        console.error(error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();
