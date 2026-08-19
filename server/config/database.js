const { Pool } = require("pg");
require("dotenv").config();

const dbUrl = process.env.DATABASE_URL || "";
// Remote databases (Render) require TLS. Detect that rather than relying
// on DB_SSL being set, so recovery scripts run from a local shell without
// needing the flag remembered at the moment it matters most.
const isRemote = dbUrl.startsWith("postgres") && !/@(localhost|127\.0\.0\.1)/.test(dbUrl);
const useSSL = process.env.DB_SSL === "true" || isRemote;

const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: useSSL ? { rejectUnauthorized: false } : false
    })
    : new Pool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT,
        ssl: useSSL ? { rejectUnauthorized: false } : false
    });

pool.connect()
    .then(() => {
        console.log("Connected to Lizimas Store Database");
    })
    .catch((error) => {
        console.log("Database connection error:", error.message);
    });

module.exports = pool;
