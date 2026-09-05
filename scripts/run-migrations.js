#!/usr/bin/env node
/**
 * Applies one or more .sql migration files against DATABASE_URL, in the
 * order given on the command line. Each file is expected to wrap itself in
 * BEGIN...COMMIT and end with its own schema_migrations ledger insert (the
 * project's existing migration convention), so this script just runs the
 * file contents as-is and stops at the first failure.
 *
 *   DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js migrations/049_vendors.sql migrations/050_products_vendor_id.sql
 *
 * On Render, use the shell there instead; locally/on a laptop, export
 * RENDER_DB with the production connection string first and pass it as
 * DATABASE_URL, exactly like scripts/unlock-admin.js does.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
    const files = process.argv.slice(2);

    if (files.length === 0) {
        console.error("Usage: node scripts/run-migrations.js <file1.sql> [file2.sql ...]");
        process.exit(1);
    }

    if (!process.env.DATABASE_URL) {
        console.error("DATABASE_URL is not set. Export RENDER_DB and pass it as DATABASE_URL.");
        process.exit(1);
    }

    const dbUrl = process.env.DATABASE_URL;
    const isRemote = dbUrl.startsWith("postgres") && !/@(localhost|127\.0\.0\.1)/.test(dbUrl);
    const useSSL = process.env.DB_SSL === "true" || isRemote;

    const pool = new Pool({
        connectionString: dbUrl,
        ssl: useSSL ? { rejectUnauthorized: false } : false
    });

    for (const file of files) {
        const fullPath = path.resolve(file);
        console.log(`\n--- Applying ${file} ---`);
        const sql = fs.readFileSync(fullPath, "utf8");
        try {
            await pool.query(sql);
            console.log(`OK: ${file}`);
        } catch (error) {
            console.error(`FAILED: ${file}`);
            console.error(error.message);
            await pool.end();
            process.exit(1);
        }
    }

    console.log("\nAll migrations applied successfully.");
    await pool.end();
}

main();
