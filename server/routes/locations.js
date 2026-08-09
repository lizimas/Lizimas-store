const express = require("express");
const router = express.Router();

const {
    getRegions,
    getDistricts,
    getDivisions,
    getParishes,
    searchLocations,
    getLocation
} = require("../controllers/locationController");

router.get("/regions", getRegions);
router.get("/districts", getDistricts);
router.get("/divisions", getDivisions);
router.get("/parishes", getParishes);
router.get("/search", searchLocations);

// Keep last — a literal path above would otherwise be swallowed by :id
router.get("/:id", getLocation);

module.exports = router;
