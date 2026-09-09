#!/usr/bin/env node
/**
 * Applies pending .sql migrations against DATABASE_URL.
 *
 * With no arguments, discovers every migrations/*.sql file, sorts them
 * numerically by filename, skips any already recorded in schema_migrations,
 * and applies the rest in order. With explicit filenames, applies exactly
 * those (still skipping already-applied ones unless --force is passed).
 *
 * Each file wraps itself in BEGIN...COMMIT and ends with its own
 * schema_migrations ledger insert, so this script runs file contents as-is
 * and stops at the first failure.
 *
 *   DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js --dry-run
 *   DATABASE_URL="$RENDER_DB" node scripts/run-migrations.js
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");

async function appliedFilenames(pool) {
    try {
        const { rows } = await pool.query("SELECT filename FROM schema_migrations");
        return new Set(rows.map((r) => r.filename));
    } catch (error) {
        if (error.code === "42P01") {
            console.log("schema_migrations does not exist yet - treating all migrations as pending.");
            return new Set();
        }
        throw error;
    }
}

function discoverMigrations() {
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => path.join("migrations", f));
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    const explicit = args.filter((a) => !a.startsWith("--"));

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

    const done = force ? new Set() : await appliedFilenames(pool);
    const candidates = explicit.length > 0 ? explicit : discoverMigrations();
    const pending = candidates.filter((f) => !done.has(path.basename(f)));

    if (pending.length === 0) {
        console.log("No pending migrations. Database is up to date.");
        await pool.end();
        return;
    }

    console.log(pending.length + " pending migration(s):");
    pending.forEach((f) => console.log("  " + path.basename(f)));

    if (dryRun) {
        console.log("\n--dry-run: nothing applied.");
        await pool.end();
        return;
    }

    for (const file of pending) {
        const fullPath = path.resolve(file);
        console.log("\n--- Applying " + path.basename(file) + " ---");
        const sql = fs.readFileSync(fullPath, "utf8");

        if (!sql.includes("BEGIN")) {
            console.warn("  WARNING: " + path.basename(file) + " is not wrapped in a transaction - a partial failure will leave the schema and ledger out of sync.");
        }

        try {
            await pool.query(sql);
            console.log("OK: " + path.basename(file));
        } catch (error) {
            console.error("FAILED: " + path.basename(file));
            console.error(error.message);
            await pool.end();
            process.exit(1);
        }
    }

    console.log("\nAll migrations applied successfully.");
    await pool.end();
}

main();
