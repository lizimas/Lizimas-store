const pool = require("../config/database");

exports.logSearch = async (req, res) => {
    try {
        const { query } = req.body;

        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: "Query is required." });
        }

        await pool.query(
            "INSERT INTO search_logs (query) VALUES ($1)",
            [query.trim()]
        );

        res.status(201).json({ message: "Search logged." });

    } catch (error) {
        console.error("Log search error:", error);
        res.status(500).json({ error: "Could not log search." });
    }
};

exports.getSearchStats = async (req, res) => {
    try {
        const totalResult = await pool.query(
            "SELECT COUNT(*) AS total FROM search_logs"
        );

        const topTermsResult = await pool.query(
            `SELECT query, COUNT(*) AS count
             FROM search_logs
             GROUP BY query
             ORDER BY count DESC
             LIMIT 10`
        );

        const recentResult = await pool.query(
            `SELECT COUNT(*) AS count
             FROM search_logs
             WHERE created_at >= NOW() - INTERVAL '7 days'`
        );

        res.json({
            totalSearches: Number(totalResult.rows[0].total),
            searchesLast7Days: Number(recentResult.rows[0].count),
            topTerms: topTermsResult.rows
        });

    } catch (error) {
        console.error("Get search stats error:", error);
        res.status(500).json({ error: "Could not load search stats." });
    }
};
