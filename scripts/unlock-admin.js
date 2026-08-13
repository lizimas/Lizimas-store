#!/usr/bin/env node
/**
 * Last-resort recovery. Clears a security lock and opens the one-hour
 * enrolment window, for when the locked account is the only administrator
 * and there is no working session to unlock it from the panel.
 *
 *   node scripts/unlock-admin.js you@example.com
 *
 * Runs against DATABASE_URL, so on Render use the shell there, or export
 * RENDER_DB locally and pass it as DATABASE_URL.
 */

const pool = require("../server/config/database");

async function main() {
    const email = process.argv[2];

    if (!email) {
        console.error("Usage: node scripts/unlock-admin.js <email>");
        process.exit(1);
    }

    try {
        const result = await pool.query(
            `UPDATE users
                SET security_locked_at = NULL,
                    security_locked_reason = NULL,
                    device_grace_until = NOW() + INTERVAL '15 minutes'
              WHERE email = $1
              RETURNING id, email, role`,
            [email]
        );

        if (result.rows.length === 0) {
            console.error(`No account found for ${email}`);
            process.exit(1);
        }

        const user = result.rows[0];
        console.log(`Unlocked ${user.email} (${user.role}, id ${user.id}).`);
        console.log("Sign in within the next 15 minutes to register that device.");
    } catch (error) {
        console.error("Unlock failed:", error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
