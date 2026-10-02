// Specification fields that depend on the product's category (Ryan, Oct
// 2026). The category's own name and its parents' names are matched against
// the groups below; the first group that matches gives the fields shown on
// the product form. What the vendor fills in is saved as ordinary
// specification rows, so it shows in the product page's Specifications table.
//
//   LzCategorySpecs.forPath(["Phones & Tablets", "Android Phones"]) -> { group, fields: [{ label, hint, options? }] }
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.LzCategorySpecs = factory();
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";
    const f = (label, hint, options) => ({ label, hint: hint || "", options: options || null });
    const GROUPS = [
        { group: "Phones & Tablets", match: /phone|tablet|smartphone|ipad|android|iphone/i, fields: [
            f("Chipset Manufacturer", "Ex: Qualcomm"), f("CPU Cores", "Ex: 8 cores"), f("CPU Speed (GHz)", "Ex: 2.84 GHz"),
            f("Display Size (inch)", "Ex: 6.5 inches"), f("Rear Camera (Megapixels)", "Ex: 48 MP"), f("Ram", "Ex: 8 GB", ["2 GB", "3 GB", "4 GB", "6 GB", "8 GB", "12 GB", "16 GB"]),
            f("Network Coverage", "Ex: 5G, 4G LTE"), f("Operating System", "Ex: Android 14", ["Android", "iOS", "HarmonyOS", "Other"]), f("Storage Capacity", "Ex: 128 GB", ["16 GB", "32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"]),
            f("Battery Capacity (mAh)", "Ex: 5000 mAh"), f("SIM Type", "Ex: Dual SIM", ["Single SIM", "Dual SIM", "eSIM", "Dual SIM + eSIM"]) ] },
        { group: "Computers", match: /laptop|computer|desktop|notebook|monitor|\bpc\b/i, fields: [
            f("Processor", "Ex: Intel Core i5"), f("CPU Speed (GHz)", "Ex: 2.4 GHz"), f("Ram", "Ex: 8 GB", ["4 GB", "8 GB", "16 GB", "32 GB", "64 GB"]),
            f("Storage Capacity", "Ex: 512 GB SSD"), f("Storage Type", "Ex: SSD", ["SSD", "HDD", "SSD + HDD", "eMMC"]), f("Display Size (inch)", "Ex: 15.6 inches"),
            f("Graphics", "Ex: Intel Iris Xe"), f("Operating System", "Ex: Windows 11", ["Windows", "macOS", "Linux", "ChromeOS", "None"]), f("Battery Life (hours)", "Ex: 8 hours") ] },
        { group: "TV, Audio & Video", match: /\btv\b|television|audio|speaker|headphone|earphone|earbud|home theat|sound|projector/i, fields: [
            f("Screen Size (inch)", "Ex: 43 inches"), f("Display Resolution", "Ex: 4K UHD", ["HD", "Full HD", "4K UHD", "8K"]), f("Display Technology", "Ex: LED", ["LED", "QLED", "OLED", "LCD"]),
            f("Smart TV", "Ex: Yes", ["Yes", "No"]), f("Connectivity", "Ex: HDMI, USB, Bluetooth"), f("Power (Watts)", "Ex: 60 W") ] },
        { group: "Cameras", match: /camera|photography|lens|cctv/i, fields: [
            f("Megapixels", "Ex: 24 MP"), f("Sensor Type", "Ex: CMOS"), f("Optical Zoom", "Ex: 3x"), f("Video Resolution", "Ex: 4K"), f("Connectivity", "Ex: Wi-Fi, Bluetooth") ] },
        { group: "Appliances", match: /appliance|kitchen|fridge|refrigerat|freezer|cooker|oven|microwave|blender|kettle|flask|fryer|toaster|iron|washing|fan|air condition|vacuum/i, fields: [
            f("Capacity", "Ex: 1.8 Litres"), f("Power (Watts)", "Ex: 1500 W"), f("Voltage", "Ex: 220-240 V"), f("Main Material", "Ex: Stainless steel"), f("Colour", "Ex: Silver"), f("Energy Rating", "Ex: A+") ] },
        { group: "Fashion", match: /fashion|cloth|apparel|dress|shirt|trouser|jean|skirt|shoe|sneaker|sandal|wear|jacket|suit|underwear/i, fields: [
            f("Main Material", "Ex: Cotton"), f("Material Family", "Ex: Natural fibre", ["Cotton", "Polyester", "Denim", "Leather", "Linen", "Silk", "Wool", "Synthetic", "Blend"]), f("Note", "Ex: Limited availability during holiday season"),
            f("Product Line", "Ex: Alpha Series"), f("Size (L x W x H cm)", "Ex: 10 x 8 x 5 cm"), f("Warranty Duration", "Ex: 2 years", ["None", "6 months", "1 year", "2 years"]),
            f("Warranty Type", "Ex: Service centre - Kampala", ["Service centre", "Repair by vendor", "Replacement"]), f("Youtube ID", "Ex: a1b2c3d4"), f("Age Group", "Ex: Adults", ["Adults", "Teens", "Kids", "Toddlers", "Babies"]),
            f("Dress Style", "Ex: Casual, Formal", ["Casual", "Formal", "Party", "Traditional", "Office", "Sports"]), f("Gender", "Ex: Female", ["Female", "Male", "Unisex", "Girls", "Boys"]), f("Pant Type", "Ex: Jeans, Chinos"),
            f("Season", "Ex: Summer", ["All seasons", "Dry season", "Rainy season", "Summer", "Winter"]), f("Skirts Type", "Ex: Pencil, A-Line"), f("Sleeve Length", "Ex: Long, Short", ["Sleeveless", "Short", "Three-quarter", "Long"]),
            f("Men's Pant Sizes", "Ex: 32, 34"), f("Size Conversion Type", "Ex: US to EU", ["UK", "US", "EU", "US to EU", "UK to EU"]) ] },
        { group: "Bags & Accessories", match: /bag|handbag|backpack|wallet|luggage|watch|jewel|accessor|belt|sunglass/i, fields: [
            f("Main Material", "Ex: Leather"), f("Gender", "Ex: Unisex", ["Men", "Women", "Unisex"]), f("Dimensions (cm)", "Ex: 30 x 20 x 10"), f("Colour", "Ex: Brown"), f("Closure Type", "Ex: Zip") ] },
        { group: "Health & Beauty", match: /beauty|health|cosmetic|skin|hair|perfume|fragrance|makeup|personal care|soap|lotion/i, fields: [
            f("Volume / Weight", "Ex: 200 ml"), f("Skin / Hair Type", "Ex: All skin types"), f("Main Ingredients", "Ex: Shea butter"), f("Scent", "Ex: Vanilla"), f("Expiry Date", "Ex: 12/2027"), f("NDA Registration No.", "If it has one") ] },
        { group: "Food & Drinks", match: /food|grocery|grocer|supermarket|drink|beverage|rice|grain|snack|juice|water|tea|coffee|cooking|cola/i, fields: [
            f("Net Weight / Volume", "Ex: 1 kg"), f("Flavour", "Ex: Original"), f("Ingredients", "Ex: Maize flour"), f("Expiry Date", "Ex: 12/2027"), f("Storage Instructions", "Ex: Keep in a cool dry place"), f("UNBS Certification No.", "If it has one") ] },
        { group: "Baby Products", match: /baby|kids|toy|diaper|infant|child/i, fields: [
            f("Age Range", "Ex: 0-6 months"), f("Main Material", "Ex: Cotton"), f("Size", "Ex: Size 3"), f("Pieces in Pack", "Ex: 40"), f("Safety Information", "Ex: BPA free") ] },
        { group: "Home & Furniture", match: /home|furniture|bedding|decor|mattress|sofa|chair|table|curtain|glassware|mug|cleaning|freshener/i, fields: [
            f("Main Material", "Ex: Wood"), f("Dimensions (cm)", "Ex: 120 x 60 x 75"), f("Colour", "Ex: Walnut"), f("Assembly Required", "Ex: Yes", ["Yes", "No"]), f("Pieces in Set", "Ex: 6") ] },
        { group: "Books & Stationery", match: /book|stationer|office|pen|paper|notebook/i, fields: [
            f("Author / Brand", "Ex: Chinua Achebe"), f("Language", "Ex: English"), f("Pages", "Ex: 240"), f("Format", "Ex: Paperback", ["Paperback", "Hardcover", "Other"]), f("ISBN", "If it has one") ] },
        { group: "Sports & Outdoors", match: /sport|fitness|gym|outdoor|bicycle|camping/i, fields: [
            f("Main Material", "Ex: Steel"), f("Weight (kg)", "Ex: 5 kg"), f("Dimensions (cm)", "Ex: 100 x 50"), f("Suitable For", "Ex: Home gym") ] },
        { group: "Automotive", match: /auto|car\b|motor|vehicle|tyre|tire/i, fields: [
            f("Compatible Vehicle", "Ex: Toyota Premio 2007-2015"), f("Part Number", "Ex: 90915-YZZE1"), f("Main Material", "Ex: Rubber"), f("Dimensions", "Ex: 195/65 R15") ] }
    ];
    // The category's own name counts most: it is tried before its parents.
    function forPath(names) {
        const list = (names || []).filter(Boolean).map(String);
        for (let i = list.length - 1; i >= 0; i--) {
            const g = GROUPS.find((x) => x.match.test(list[i]));
            if (g) return { group: g.group, fields: g.fields };
        }
        return { group: null, fields: [] };
    }
    return { forPath, GROUPS };
});
