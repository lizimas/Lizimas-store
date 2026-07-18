const ORIGIN_LAT = 0.3138978;
const ORIGIN_LNG = 32.6220405;
const KAMPALA_RADIUS_KM = 15;
const KAMPALA_FLAT_FEE = 7000;
const OUTSIDE_BASE_FEE = 5000;
const OUTSIDE_PER_KM = 2000;

function toRad(value) {
    return (value * Math.PI) / 180;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function computeFeeFromDistance(distanceKm) {
    if (distanceKm <= KAMPALA_RADIUS_KM) {
        return KAMPALA_FLAT_FEE;
    }
    return OUTSIDE_BASE_FEE + OUTSIDE_PER_KM * Math.ceil(distanceKm - KAMPALA_RADIUS_KM);
}

exports.getDeliveryFee = async (req, res) => {
    try {
        const { address, method, lat, lng } = req.query;

        if (method === "pickup") {
            return res.json({ fee: 0, distanceKm: 0, method: "pickup" });
        }

        if (lat && lng) {
            const latNum = parseFloat(lat);
            const lngNum = parseFloat(lng);

            const distanceKm = haversineDistanceKm(ORIGIN_LAT, ORIGIN_LNG, latNum, lngNum);
            const fee = computeFeeFromDistance(distanceKm);

            let displayAddress = `Pinned location (${latNum.toFixed(5)}, ${lngNum.toFixed(5)})`;

            try {
                const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${latNum}&lon=${lngNum}&format=json`;
                const reverseResponse = await fetch(reverseUrl, {
                    headers: { "User-Agent": "LizimasStore/1.0 (order delivery fee lookup)" }
                });
                if (reverseResponse.ok) {
                    const reverseData = await reverseResponse.json();
                    if (reverseData && reverseData.display_name) {
                        displayAddress = reverseData.display_name;
                    }
                }
            } catch (reverseError) {
                console.error("Reverse geocoding failed:", reverseError);
            }

            return res.json({
                fee,
                distanceKm: Number(distanceKm.toFixed(1)),
                method: "delivery",
                resolvedAddress: displayAddress
            });
        }

        if (!address || address.trim().length < 3) {
            return res.status(400).json({ error: "Please enter a delivery address." });
        }

        const alreadyMentionsUganda = /uganda/i.test(address);
        const searchText = alreadyMentionsUganda ? address : `${address}, Uganda`;
        const query = encodeURIComponent(searchText);
        const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=5&addressdetails=1`;

        const response = await fetch(url, {
            headers: { "User-Agent": "LizimasStore/1.0 (order delivery fee lookup)" }
        });

        if (!response.ok) {
            throw new Error(`Geocoding request failed: ${response.status}`);
        }

        const results = await response.json();

        if (!results || results.length === 0) {
            return res.status(404).json({
                error: "Could not locate that address. Please include more detail (area, town, or district)."
            });
        }

        const roadTypes = ["road", "highway", "primary", "trunk", "secondary", "residential"];
        const bestMatch = results.find(r => !roadTypes.includes(r.addresstype) && !roadTypes.includes(r.type)) || results[0];

        const lat2 = parseFloat(bestMatch.lat);
        const lon2 = parseFloat(bestMatch.lon);

        const distanceKm = haversineDistanceKm(ORIGIN_LAT, ORIGIN_LNG, lat2, lon2);
        const fee = computeFeeFromDistance(distanceKm);

        res.json({
            fee,
            distanceKm: Number(distanceKm.toFixed(1)),
            method: "delivery"
        });

    } catch (error) {
        console.error("Delivery fee error:", error);
        res.status(500).json({ error: "Could not calculate delivery fee. Please try again." });
    }
};
