const pool = require("../config/database");
const { getOrderPackageSize } = require("../utils/deliveryPricing");

// GET /api/delivery/fee?method=pickup
// GET /api/delivery/fee?method=delivery&district=Kampala&product_ids=12,45,7
exports.getDeliveryFee = async (req, res) => {
    try {
        const { method, district, location_id, product_ids } = req.query;

        if (method === "pickup") {
            return res.json({ fee: 0, method: "pickup" });
        }

        const locationId = Number.parseInt(location_id, 10);
        const hasLocation = Number.isSafeInteger(locationId) && locationId > 0;

        if (!hasLocation && !district) {
            return res.status(400).json({ error: "Please select a delivery location." });
        }
        if (!product_ids) {
            return res.status(400).json({ error: "No items in cart to calculate delivery for." });
        }

        const ids = product_ids.split(",").map(id => parseInt(id, 10)).filter(Boolean);
        if (ids.length === 0) {
            return res.status(400).json({ error: "No valid items in cart." });
        }

        const productsResult = await pool.query(
            "SELECT id, package_size FROM products WHERE id = ANY($1::int[])",
            [ids]
        );

        if (productsResult.rows.length === 0) {
            return res.status(404).json({ error: "Could not find cart items." });
        }

        // resolve_delivery_zone() walks up from any depth - parish, division
        // or district - to the district that carries the pricing row.
        const zoneResult = hasLocation
            ? await pool.query(
                "SELECT district, zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta FROM resolve_delivery_zone($1)",
                [locationId]
            )
            : await pool.query(
                "SELECT district, zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta FROM delivery_zones WHERE district = $1",
                [district]
            );

        // A composite-returning function yields one all-NULL row on no match,
        // so check the column rather than the row count.
        if (zoneResult.rows.length === 0 || !zoneResult.rows[0].district) {
            return res.status(404).json({ error: "Delivery is not yet available for that area." });
        }

        const zoneRow = zoneResult.rows[0];
        const districtName = zoneRow.district;
        const packageSize = getOrderPackageSize(productsResult.rows);

        if (packageSize === "Extra Large") {
            return res.json({
                method: "delivery",
                district: districtName,
                locationId: hasLocation ? locationId : null,
                zone: zoneRow.zone,
                eta: zoneRow.eta,
                packageSize,
                fee: null,
                quoteRequired: true,
                message: "This order requires a custom delivery quote. Contact us to arrange delivery."
            });
        }

        const feeMap = {
            "Small": zoneRow.small_fee_ugx,
            "Medium": zoneRow.medium_fee_ugx,
            "Large": zoneRow.large_fee_ugx
        };

        return res.json({
            method: "delivery",
            district: districtName,
            locationId: hasLocation ? locationId : null,
            zone: zoneRow.zone,
            eta: zoneRow.eta,
            packageSize,
            fee: feeMap[packageSize],
            quoteRequired: false
        });

    } catch (error) {
        console.error("Delivery fee error:", error);
        res.status(500).json({ error: "Could not calculate delivery fee. Please try again." });
    }
};

// GET /api/delivery/districts
exports.getDistricts = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT district, zone, eta, location_id FROM delivery_zones ORDER BY zone, district"
        );
        res.json({ districts: result.rows });
    } catch (error) {
        console.error("List districts error:", error);
        res.status(500).json({ error: "Could not load delivery districts." });
    }
};

/**
 * Matches an OpenStreetMap reverse-geocode result to a row in `locations`.
 *
 * OSM and UBOS name the same places differently - OSM returns bare names
 * ("Nakawa") while UBOS stores administrative suffixes ("Nakawa Division"),
 * so both sides are stripped before comparing. Matching runs most-specific
 * first: a village-level hit is better than a district-level one.
 *
 * Returns null rather than guessing when nothing matches cleanly - a wrong
 * area means a wrong delivery fee, which is worse than an empty field.
 */
exports.matchLocation = async (req, res) => {
    try {
        const SUFFIX = "(county|division|municipality|sub ?county|subcounty|parish|ward|town council|city)";

        const norm = (v) => String(v || "")
            .toLowerCase()
            .replace(new RegExp("\\s+" + SUFFIX + "$", "i"), "")
            .replace(/[^a-z0-9 ]/g, "")
            .trim();

        const findOne = async (needle, levels, underPath) => {
            if (!needle || needle.length < 3) return null;
            const params = [needle, levels];
            let sql = `SELECT id, name, level, label, path
                         FROM locations
                        WHERE is_active = TRUE
                          AND level = ANY($2::int[])
                          AND regexp_replace(name_norm, '\\s+${SUFFIX}$', '') = $1`;
            if (underPath) {
                params.push(underPath + "%");
                sql += ` AND path LIKE $3`;
            }
            sql += ` ORDER BY array_position($2::int[], level) LIMIT 1`;
            const { rows } = await pool.query(sql, params);
            return rows[0] || null;
        };

        // Anchor on the district first. Uganda reuses place names heavily -
        // there are six Luziras - so an unanchored match can land 400km away.
        const district =
            (await findOne(norm(req.body.city), [2])) ||
            (await findOne(norm(req.body.state), [2])) ||
            (await findOne(norm(req.body.county), [2]));

        const scope = district ? district.path + district.id + "/" : null;

        const finer = [
            { v: req.body.suburb,        levels: [5, 4] },
            { v: req.body.neighbourhood, levels: [5, 4] },
            { v: req.body.village,       levels: [5, 4] },
            { v: req.body.hamlet,        levels: [5, 4] },
            { v: req.body.city_district, levels: [4, 3] },
            { v: req.body.county,        levels: [4, 3] }
        ];

        for (const f of finer) {
            const hit = await findOne(norm(f.v), f.levels, scope);
            if (hit) {
                return res.json({ location: hit, matched_on: f.v, district: district ? district.name : null });
            }
        }

        if (district) {
            return res.json({ location: district, matched_on: district.name, district: district.name });
        }

        res.json({ location: null });
    } catch (error) {
        console.error("Location match error:", error);
        res.status(500).json({ error: "Could not match location." });
    }
};
