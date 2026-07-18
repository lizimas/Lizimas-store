const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

pool.connect()
    .then(() => {
        console.log("Connected to Lizimas Store Database");
    })
    .catch((error) => {
        console.log("Database connection error:", error.message);
    });

module.exports = pool;
