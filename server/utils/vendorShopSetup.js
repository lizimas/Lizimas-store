// Vendor shop-setup onboarding (mobile Home, Ryan Sept 2026) - the
// Jumia-style "Let's take your shop live!" checklist. Pure helpers only
// (no DB), so the step rules are unit-testable and shared by the
// controller (server/controllers/vendorShopSetupController.js).
//
// Step status is DERIVED from what is actually on file, never stored -
// there is no "mark step complete" flag anywhere that could drift out of
// sync with the real data.

const SHOP_SETUP_STEPS = ["shop", "company", "shipping", "payment", "additional"];

const LEGAL_REP_ID_TYPES = ["national_id", "passport", "driving_permit", "refugee_id"];
const LEGAL_REP_ID_TYPE_LABELS = {
    national_id: "National ID",
    passport: "Passport",
    driving_permit: "Driving Permit",
    refugee_id: "Refugee ID"
};

const DEFAULT_COUNTRY = "Uganda";

// Additional Information options (Jumia seller onboarding parity).
const SELLER_TYPES = ["manufacturer", "brand_owner", "distributor", "wholesaler", "retailer", "importer", "reseller"];
const SELLER_TYPE_LABELS = {
    manufacturer: "Manufacturer",
    brand_owner: "Brand Owner",
    distributor: "Distributor",
    wholesaler: "Wholesaler",
    retailer: "Retailer",
    importer: "Importer",
    reseller: "Reseller"
};
const SOURCING_METHODS = ["import", "local_sourcing", "local_producer", "international_brands", "local_brands", "dropshipping"];
const SOURCING_METHOD_LABELS = {
    import: "Import",
    local_sourcing: "Local sourcing",
    local_producer: "Local Producer",
    international_brands: "International Brand(s)",
    local_brands: "Local Brand(s)",
    dropshipping: "DropShipping"
};

const MAX_LEN = {
    name: 200,
    email: 255,
    phone: 20,
    line: 255,
    city: 120,
    region: 120,
    postal: 20
};

function filled(v) {
    return typeof v === "string" ? v.trim().length > 0 : v != null && v !== "";
}

function clean(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
}

function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Accepts 07XXXXXXXX, 7XXXXXXXX, +2567XXXXXXXX, 2567XXXXXXXX (spaces/dashes
// ignored) - the same Ugandan formats the rest of the vendor portal takes.
function isValidUgPhone(v) {
    const digits = String(v).replace(/[\s-]/g, "");
    return /^(\+?256|0)?[0-9]{9}$/.test(digits);
}

function tooLong(value, max) {
    return value != null && String(value).length > max;
}

// --- Address helpers --------------------------------------------------------

const ADDRESS_FIELDS = ["address_line1", "address_line2", "city", "region", "postal_code"];

function pickAddress(body, prefix) {
    const out = {};
    for (const f of ADDRESS_FIELDS) out[f] = clean(body[`${prefix}_${f}`]);
    return out;
}

function addressComplete(addr, { requireRegion = true } = {}) {
    if (!addr) return false;
    if (!filled(addr.address_line1) || !filled(addr.city)) return false;
    if (requireRegion && !filled(addr.region)) return false;
    return true;
}

function validateAddress(addr, label, { required = true, requireRegion = true } = {}) {
    const errors = [];
    if (required) {
        if (!filled(addr.address_line1)) errors.push(`${label}: Address Line 1 is required.`);
        if (!filled(addr.city)) errors.push(`${label}: City / Town is required.`);
        if (requireRegion && !filled(addr.region)) errors.push(`${label}: State / Region is required.`);
    }
    if (tooLong(addr.address_line1, MAX_LEN.line) || tooLong(addr.address_line2, MAX_LEN.line)) errors.push(`${label}: address lines must be ${MAX_LEN.line} characters or fewer.`);
    if (tooLong(addr.city, MAX_LEN.city)) errors.push(`${label}: City / Town is too long.`);
    if (tooLong(addr.region, MAX_LEN.region)) errors.push(`${label}: State / Region is too long.`);
    if (tooLong(addr.postal_code, MAX_LEN.postal)) errors.push(`${label}: Postal code is too long.`);
    return errors;
}

// Business address as stored on vendor_kyc (business_* columns) -> the
// generic address shape used above.
function businessAddressFromKyc(kyc) {
    if (!kyc) return null;
    return {
        address_line1: kyc.business_address_line1 || null,
        address_line2: kyc.business_address_line2 || null,
        city: kyc.business_city || null,
        region: kyc.business_region || null,
        postal_code: kyc.business_postal_code || null
    };
}

// --- Validation of each form ------------------------------------------------

function validateShopInfo(body) {
    const data = {
        contact_name: clean(body.contact_name),
        contact_email: clean(body.contact_email),
        contact_phone: clean(body.contact_phone),
        cc_name: clean(body.cc_name),
        cc_phone: clean(body.cc_phone),
        cc_email: clean(body.cc_email),
        ...Object.fromEntries(Object.entries(pickAddress(body, "cc")).map(([k, v]) => [`cc_${k}`, v]))
    };
    const errors = [];
    if (!data.contact_name) errors.push("Contact Name is required.");
    if (!data.contact_email) errors.push("Contact Email is required.");
    else if (!isValidEmail(data.contact_email)) errors.push("Contact Email isn't a valid email address.");
    if (!data.contact_phone) errors.push("Contact Phone is required.");
    else if (!isValidUgPhone(data.contact_phone)) errors.push("Contact Phone isn't a valid Ugandan phone number.");

    if (!data.cc_phone) errors.push("Customer Care Phone is required.");
    else if (!isValidUgPhone(data.cc_phone)) errors.push("Customer Care Phone isn't a valid Ugandan phone number.");
    if (!data.cc_email) errors.push("Customer Care Email is required.");
    else if (!isValidEmail(data.cc_email)) errors.push("Customer Care Email isn't a valid email address.");

    if (tooLong(data.contact_name, MAX_LEN.name) || tooLong(data.cc_name, MAX_LEN.name)) errors.push(`Names must be ${MAX_LEN.name} characters or fewer.`);
    if (tooLong(data.contact_email, MAX_LEN.email) || tooLong(data.cc_email, MAX_LEN.email)) errors.push("Email is too long.");

    errors.push(...validateAddress({
        address_line1: data.cc_address_line1, address_line2: data.cc_address_line2,
        city: data.cc_city, region: data.cc_region, postal_code: data.cc_postal_code
    }, "Customer Care Address", { requireRegion: false }));

    return { data, errors };
}

function validateCompanyInfo(body, { accountType }) {
    let idTypes = body.legal_rep_id_types;
    if (typeof idTypes === "string") idTypes = [idTypes];
    idTypes = Array.isArray(idTypes) ? [...new Set(idTypes.map(String))] : [];

    const data = {
        tin_number: clean(body.tin_number),
        vat_number: clean(body.vat_number),
        legal_rep_full_name: clean(body.legal_rep_full_name),
        legal_rep_id_types: idTypes,
        ...Object.fromEntries(Object.entries(pickAddress(body, "business")).map(([k, v]) => [`business_${k}`, v]))
    };
    const errors = [];
    if (accountType === "company") {
        if (!data.tin_number) errors.push("Tax Identification Number (TIN) is required for company accounts.");
        if (!data.vat_number) errors.push("VAT Number is required for company accounts.");
    }
    if (data.tin_number && !/^[0-9A-Za-z-]{4,30}$/.test(data.tin_number)) errors.push("TIN should only contain letters, numbers or dashes.");
    if (data.vat_number && !/^[0-9A-Za-z-]{4,30}$/.test(data.vat_number)) errors.push("VAT Number should only contain letters, numbers or dashes.");
    if (!data.legal_rep_full_name) errors.push("Legal representative's Full Name is required.");
    else if (tooLong(data.legal_rep_full_name, MAX_LEN.name)) errors.push("Full Name is too long.");
    if (data.legal_rep_id_types.length === 0) errors.push("Choose at least one ID type.");
    const badType = data.legal_rep_id_types.find((t) => !LEGAL_REP_ID_TYPES.includes(t));
    if (badType) errors.push(`Unknown ID type: ${badType}.`);

    errors.push(...validateAddress({
        address_line1: data.business_address_line1, address_line2: data.business_address_line2,
        city: data.business_city, region: data.business_region, postal_code: data.business_postal_code
    }, "Legal Representative's Address"));

    return { data, errors };
}

// Shipping: when a "same as business" toggle is on, the business address
// (from vendor_kyc) is copied in server-side rather than trusting whatever
// the form sent - so the stored ship/return address can never disagree
// with the flag.
function validateShippingInfo(body, { businessAddress }) {
    const shipSame = body.ship_same_as_business === true || body.ship_same_as_business === "true";
    const returnSame = body.return_same_as_business === true || body.return_same_as_business === "true";
    const errors = [];

    if ((shipSame || returnSame) && !addressComplete(businessAddress)) {
        errors.push("Your business address isn't complete yet - fill in Company Information first, or enter the address here.");
    }

    const ship = shipSame && businessAddress ? { ...businessAddress } : pickAddress(body, "ship");
    const ret = returnSame && businessAddress ? { ...businessAddress } : pickAddress(body, "return");

    errors.push(...validateAddress(ship, "Shipping Address"));
    // Return address isn't marked Required in the Jumia flow; validate
    // lengths only unless something was entered, in which case the core
    // fields must be complete (a half-filled return address is useless).
    const retTouched = Object.values(ret).some(filled);
    errors.push(...validateAddress(ret, "Return Address", { required: retTouched, requireRegion: false }));

    return {
        data: {
            ship_same_as_business: shipSame,
            return_same_as_business: returnSame,
            ...Object.fromEntries(Object.entries(ship).map(([k, v]) => [`ship_${k}`, v])),
            ...Object.fromEntries(Object.entries(ret).map(([k, v]) => [`return_${k}`, v]))
        },
        errors: [...new Set(errors)]
    };
}

function toBool(v) {
    if (v === true || v === "true" || v === "yes") return true;
    if (v === false || v === "false" || v === "no") return false;
    return null;
}

// Additional Information is two tabs (Shop Details / Catalog Details) that
// save independently, so each part only validates the fields it sends.
function validateAdditionalInfo(body, { validCategoryIds } = {}) {
    const data = {};
    const errors = [];
    if (body.has_existing_shop !== undefined) {
        data.has_existing_shop = toBool(body.has_existing_shop);
        if (data.has_existing_shop === null) errors.push("Tell us whether you have an existing shop.");
    }
    // Follow-up questions shown only when the vendor answers Yes.
    for (const [key, max, label] of [["existing_shop_names", 500, "Shop name(s)"], ["new_shop_reason", 1000, "Reason for creating this shop"]]) {
        if (body[key] !== undefined && body[key] !== null) {
            const v = String(body[key]).trim();
            if (v.length > max) errors.push(`${label} must be ${max} characters or fewer.`);
            data[key] = v || null;
        }
    }
    if (data.has_existing_shop === true) {
        if (!data.existing_shop_names) errors.push("Enter the name(s) of your existing shop(s).");
        if (!data.new_shop_reason) errors.push("Tell us why you're creating another shop.");
    } else if (data.has_existing_shop === false) {
        data.existing_shop_names = null;
        data.new_shop_reason = null;
    }
    if (body.seller_types !== undefined) {
        let types = body.seller_types;
        if (typeof types === "string") types = [types];
        types = Array.isArray(types) ? [...new Set(types.map(String))] : [];
        if (types.length === 0) errors.push("Select at least one seller type.");
        const bad = types.find((t) => !SELLER_TYPES.includes(t));
        if (bad) errors.push(`Unknown seller type: ${bad}.`);
        data.seller_types = types;
    }
    if (body.primary_category_id !== undefined) {
        const id = Number(body.primary_category_id);
        if (!Number.isInteger(id) || id <= 0) errors.push("Select your primary product category.");
        else if (validCategoryIds && !validCategoryIds.includes(id)) errors.push("That product category isn't available.");
        data.primary_category_id = id;
    }
    if (body.sourcing_method !== undefined) {
        if (!SOURCING_METHODS.includes(body.sourcing_method)) errors.push("Select how you source your products.");
        data.sourcing_method = body.sourcing_method;
    }
    for (const [key, label] of [["sells_offline", "whether you also sell offline"], ["uses_other_channels", "whether you use other online channels"]]) {
        if (body[key] !== undefined) {
            data[key] = toBool(body[key]);
            if (data[key] === null) errors.push(`Tell us ${label}.`);
        }
    }
    if (Object.keys(data).length === 0 && errors.length === 0) errors.push("Nothing to save.");
    return { data, errors };
}

// --- Step status ------------------------------------------------------------

function shopStepComplete(profile) {
    if (!profile) return false;
    return ["contact_name", "contact_email", "contact_phone", "cc_phone", "cc_email"].every((k) => filled(profile[k]));
}

function companyStepComplete({ accountType, kyc, documentTypes }) {
    if (!kyc) return false;
    const docs = new Set(documentTypes || []);
    if (!filled(kyc.legal_rep_full_name)) return false;
    if (!Array.isArray(kyc.legal_rep_id_types) || kyc.legal_rep_id_types.length === 0) return false;
    if (!addressComplete(businessAddressFromKyc(kyc))) return false;
    if (accountType === "company") {
        if (!kyc.has_tin || !kyc.has_vat) return false;
        if (!docs.has("tax_certificate")) return false;
    }
    return true;
}

function shippingStepComplete(profile) {
    if (!profile) return false;
    return addressComplete({
        address_line1: profile.ship_address_line1,
        city: profile.ship_city,
        region: profile.ship_region
    });
}

// Rejected instruments don't count - the vendor still has to fix them.
function paymentStepComplete(instruments) {
    return (instruments || []).some((i) => i.status === "pending" || i.status === "approved");
}

function additionalShopDetailsComplete(profile) {
    return Boolean(profile) && profile.has_existing_shop != null
        && (profile.has_existing_shop !== true || (filled(profile.existing_shop_names) && filled(profile.new_shop_reason)))
        && Array.isArray(profile.seller_types) && profile.seller_types.length > 0;
}

function additionalCatalogDetailsComplete(profile) {
    return Boolean(profile) && profile.primary_category_id != null && filled(profile.sourcing_method)
        && profile.sells_offline != null && profile.uses_other_channels != null;
}

function additionalStepComplete(profile) {
    return additionalShopDetailsComplete(profile) && additionalCatalogDetailsComplete(profile);
}

function computeShopSetupSteps({ accountType, profile, kyc, documentTypes, instruments }) {
    const status = {
        shop: shopStepComplete(profile),
        company: companyStepComplete({ accountType, kyc, documentTypes }),
        shipping: shippingStepComplete(profile),
        payment: paymentStepComplete(instruments),
        additional: additionalStepComplete(profile)
    };
    const steps = SHOP_SETUP_STEPS.map((key) => ({ key, completed: status[key] }));
    return {
        steps,
        completed_count: steps.filter((s) => s.completed).length,
        all_completed: steps.every((s) => s.completed)
    };
}

module.exports = {
    SHOP_SETUP_STEPS,
    LEGAL_REP_ID_TYPES,
    LEGAL_REP_ID_TYPE_LABELS,
    DEFAULT_COUNTRY,
    SELLER_TYPES,
    SELLER_TYPE_LABELS,
    SOURCING_METHODS,
    SOURCING_METHOD_LABELS,
    isValidEmail,
    isValidUgPhone,
    addressComplete,
    businessAddressFromKyc,
    validateShopInfo,
    validateCompanyInfo,
    validateShippingInfo,
    validateAdditionalInfo,
    shopStepComplete,
    companyStepComplete,
    shippingStepComplete,
    paymentStepComplete,
    additionalShopDetailsComplete,
    additionalCatalogDetailsComplete,
    additionalStepComplete,
    computeShopSetupSteps
};
