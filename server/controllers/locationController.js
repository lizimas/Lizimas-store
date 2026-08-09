const pool = require("../config/database");

// Administrative data changes maybe twice a decade — let browsers and any
// CDN in front of Render hold onto it.
const CACHE_STATIC = "public, max-age=86400, stale-while-revalidate=604800";
const CACHE_SEARCH = "public, max-age=300";

function toInt(value) {
    const n = Number.parseInt(value, 10);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// GET /api/locations/regions
exports.getRegions = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, level, unit FROM location_options(NULL)"
        );
        res.set("Cache-Control", CACHE_STATIC);
        res.json({ regions: result.rows });
    } catch (err) {
        console.error("getRegions:", err);
        res.status(500).json({ error: "Could not load regions." });
    }
};

// GET /api/locations/districts?region_id=1
// region_id is optional — omitting it returns all 147, which is what the
// "I don't know my region" fallback needs.
exports.getDistricts = async (req, res) => {
    try {
        const regionId = toInt(req.query.region_id);

        const result = regionId
            ? await pool.query(
                  "SELECT id, name, population FROM location_options($1) ORDER BY name",
                  [regionId]
              )
            : await pool.query(
                  `SELECT l.id, l.name, l.population, r.id AS region_id, r.name AS region_name
                     FROM locations l
                     JOIN locations r ON r.id = l.region_id
                    WHERE l.level = 2 AND l.is_active
                    ORDER BY l.name`
              );

        res.set("Cache-Control", CACHE_STATIC);
        res.json({ districts: result.rows });
    } catch (err) {
        console.error("getDistricts:", err);
        res.status(500).json({ error: "Could not load districts." });
    }
};

// GET /api/locations/divisions?district_id=14
// Reaches through the county layer, which the form never shows.
exports.getDivisions = async (req, res) => {
    try {
        const districtId = toInt(req.query.district_id);
        if (!districtId) {
            return res.status(400).json({ error: "district_id is required." });
        }

        const result = await pool.query(
            "SELECT id, name, county_name, population FROM divisions_of_district($1)",
            [districtId]
        );

        res.set("Cache-Control", CACHE_STATIC);
        res.json({ divisions: result.rows });
    } catch (err) {
        console.error("getDivisions:", err);
        res.status(500).json({ error: "Could not load divisions." });
    }
};

// GET /api/locations/parishes?division_id=4609
exports.getParishes = async (req, res) => {
    try {
        const divisionId = toInt(req.query.division_id);
        if (!divisionId) {
            return res.status(400).json({ error: "division_id is required." });
        }

        const result = await pool.query(
            "SELECT id, name, population FROM parishes_of_division($1)",
            [divisionId]
        );

        res.set("Cache-Control", CACHE_STATIC);
        res.json({ parishes: result.rows });
    } catch (err) {
        console.error("getParishes:", err);
        res.status(500).json({ error: "Could not load parishes." });
    }
};

// GET /api/locations/search?q=ntinda&within=14&limit=10
// One box across divisions and parishes. Misses are logged so the alias
// table can be grown from what customers actually type.
exports.searchLocations = async (req, res) => {
    try {
        const q = (req.query.q || "").trim();
        if (q.length < 2) {
            return res.json({ results: [] });
        }
        if (q.length > 60) {
            return res.status(400).json({ error: "Search term is too long." });
        }

        const within = toInt(req.query.within);
        const limit = Math.min(toInt(req.query.limit) || 15, 25);

        const result = await pool.query(
            `SELECT id, name, level, unit, district_name, division_name, matched_alias
               FROM search_locations($1, $2, $3)`,
            [q, limit, within]
        );

        if (result.rows.length === 0) {
            // Fire and forget — a logging failure must never break checkout.
            pool.query(
                `INSERT INTO location_search_misses (query, query_norm, hits, user_id)
                 VALUES ($1, lower(unaccent(btrim($1))), 0, $2)`,
                [q, req.user ? req.user.id : null]
            ).catch((e) => console.error("miss log:", e.message));
        }

        res.set("Cache-Control", CACHE_SEARCH);
        res.json({ results: result.rows });
    } catch (err) {
        console.error("searchLocations:", err);
        res.status(500).json({ error: "Search failed." });
    }
};

// GET /api/locations/:id
// Resolves one pick into the whole chain, so the form can back-fill every
// field above it from a single selection.
exports.getLocation = async (req, res) => {
    try {
        const id = toInt(req.params.id);
        if (!id) {
            return res.status(400).json({ error: "Invalid location id." });
        }

        const result = await pool.query(
            `SELECT lf.id, lf.level, lf.name, lf.label,
                    lf.region_name, lf.district_name, lf.county_name,
                    lf.subcounty_name AS division_name, lf.parish_name,
                    l.region_id, l.district_id, l.subcounty_id,
                    lf.latitude, lf.longitude
               FROM location_full lf
               JOIN locations l ON l.id = lf.id
              WHERE lf.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Location not found." });
        }

        const location = result.rows[0];

        // Attach pricing where the anchor is deep enough to resolve one.
        const zone = await pool.query(
            "SELECT district, zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta FROM resolve_delivery_zone($1)",
            [id]
        );

        res.set("Cache-Control", CACHE_STATIC);
        res.json({
            location,
            delivery: zone.rows[0] || null
        });
    } catch (err) {
        console.error("getLocation:", err);
        res.status(500).json({ error: "Could not load location." });
    }
};
