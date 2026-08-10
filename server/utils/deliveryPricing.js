/*
 * server/utils/deliveryPricing.js
 * Lizimas Store - single source of delivery pricing.
 *
 * Both the quote endpoint and order creation price through here so the
 * two cannot drift. Every input is read from the database: the caller
 * supplies only a location and a list of product ids.
 */

// Order of tiers, low to high - used to find the "largest" size across cart items
const SIZE_RANK = { "Small": 1, "Medium": 2, "Large": 3, "Extra Large": 4 };

const ZONE_COLUMNS =
    "district, zone, small_fee_ugx, medium_fee_ugx, large_fee_ugx, eta";

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

/*
 * Price an order.
 *
 * db          - anything with .query(): the pool, or a transaction client
 * locationId  - preferred; resolves the zone from any anchor depth
 * district    - legacy fallback when no locationId is available
 * productIds  - cart product ids, used to derive the package size
 *
 * Returns one of:
 *   { error: "no_items" | "no_location" | "not_serviced", packageSize? }
 *   { zoneRow, districtName, packageSize, fee: null, quoteRequired: true }
 *   { zoneRow, districtName, packageSize, fee: <number>, quoteRequired: false }
 */
async function priceOrder(db, { locationId, district, productIds } = {}) {
    const ids = (productIds || [])
        .map(id => parseInt(id, 10))
        .filter(Boolean);

    if (ids.length === 0) {
        return { error: "no_items" };
    }

    const locId = Number(locationId);
    const hasLocation = Number.isSafeInteger(locId) && locId > 0;

    if (!hasLocation && !district) {
        return { error: "no_location" };
    }

    const productsResult = await db.query(
        "SELECT id, package_size FROM products WHERE id = ANY($1::int[])",
        [ids]
    );
    const packageSize = getOrderPackageSize(productsResult.rows);

    // resolve_delivery_zone() walks up from any depth - parish, division or
    // district - to the district that carries the pricing row.
    const zoneResult = hasLocation
        ? await db.query(
            `SELECT ${ZONE_COLUMNS} FROM resolve_delivery_zone($1)`,
            [locId]
        )
        : await db.query(
            `SELECT ${ZONE_COLUMNS} FROM delivery_zones WHERE district = $1`,
            [district]
        );

    // A composite-returning function yields one all-NULL row on no match,
    // so check the column rather than the row count.
    if (zoneResult.rows.length === 0 || !zoneResult.rows[0].district) {
        return { error: "not_serviced", packageSize };
    }

    const zoneRow = zoneResult.rows[0];

    // No fourth fee column exists, by design - these are quoted by hand.
    if (packageSize === "Extra Large") {
        return {
            zoneRow,
            districtName: zoneRow.district,
            packageSize,
            fee: null,
            quoteRequired: true
        };
    }

    const feeMap = {
        "Small": zoneRow.small_fee_ugx,
        "Medium": zoneRow.medium_fee_ugx,
        "Large": zoneRow.large_fee_ugx
    };

    return {
        zoneRow,
        districtName: zoneRow.district,
        packageSize,
        fee: Number(feeMap[packageSize]),
        quoteRequired: false
    };
}

module.exports = { SIZE_RANK, getOrderPackageSize, priceOrder };
