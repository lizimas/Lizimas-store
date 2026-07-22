const pool = require("../config/database");

// Order of tiers, low to high — used to find the "largest" size across cart items
const SIZE_RANK = { "Small": 1, "Medium": 2, "Large": 3, "Extra Large": 4 };

function getOrderPackageSize(items) {
    let maxSize = "Small";
    for (const item of items) {
        const size = item.package_size || "Small";
        if ((SIZE_RANK[size] || 1) > SIZE_RANK[maxSize]) {
            maxSize = size;
        }
    }
    return maxSize;
}

// GET /api/delivery/fee?method=pickup
// GET /api/delivery/fee?method=delivery&district=Kampala&product_ids=12,45,7
exports.getDeliveryFee = async (req, res) => {
    try {
        const { method, district, product_ids } = req.query;

        if (method === "pickup") {
            return res.json({ fee: 0, method: "pickup" });
        }

        if (!district) {
            return res.status(400).json({ error: "Please select a delivery district." });
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

        const zoneResult = await pool.query(
            "SELECT zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta FROM delivery_zones WHERE district = $1",
            [district]
        );

        if (zoneResult.rows.length === 0) {
            return res.status(404).json({ error: "Delivery is not yet available for that district." });
        }

        const zoneRow = zoneResult.rows[0];
        const packageSize = getOrderPackageSize(productsResult.rows);

        if (packageSize === "Extra Large") {
            return res.json({
                method: "delivery",
                district,
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
            district,
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
            "SELECT district, zone, eta FROM delivery_zones ORDER BY zone, district"
        );
        res.json({ districts: result.rows });
    } catch (error) {
        console.error("List districts error:", error);
        res.status(500).json({ error: "Could not load delivery districts." });
    }
};
