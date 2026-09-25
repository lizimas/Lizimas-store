const test = require("node:test");
const assert = require("node:assert/strict");

const {
    validateShopInfo, validateCompanyInfo, validateShippingInfo, validateAdditionalInfo,
    computeShopSetupSteps, isValidUgPhone, paymentStepComplete, companyStepComplete
} = require("../server/utils/vendorShopSetup");

const fullShop = {
    contact_name: "Ann", contact_email: "ann@x.com", contact_phone: "0772123456",
    cc_name: "Care", cc_phone: "+256772123456", cc_email: "care@x.com",
    cc_address_line1: "Plot 1", cc_city: "Kampala"
};
const bizAddress = { address_line1: "Plot 9", address_line2: null, city: "Kampala", region: "Central", postal_code: null };

test("isValidUgPhone accepts local and international formats", () => {
    for (const p of ["0772123456", "772123456", "+256772123456", "256 772 123 456"]) assert.equal(isValidUgPhone(p), true, p);
    for (const p of ["12345", "07721234567", "abc"]) assert.equal(isValidUgPhone(p), false, p);
});

test("validateShopInfo: complete form passes, missing contact fails", () => {
    assert.deepEqual(validateShopInfo(fullShop).errors, []);
    const { errors } = validateShopInfo({ ...fullShop, contact_email: "nope", cc_phone: "" });
    assert.ok(errors.some((e) => /Contact Email/.test(e)));
    assert.ok(errors.some((e) => /Customer Care Phone/.test(e)));
});

test("validateCompanyInfo: company needs TIN + VAT, individual doesn't", () => {
    const base = {
        legal_rep_full_name: "Ann A", legal_rep_id_types: ["national_id"],
        business_address_line1: "Plot 9", business_city: "Kampala", business_region: "Central"
    };
    assert.ok(validateCompanyInfo(base, { accountType: "company" }).errors.some((e) => /TIN/.test(e)));
    assert.deepEqual(validateCompanyInfo(base, { accountType: "individual" }).errors, []);
    assert.deepEqual(validateCompanyInfo({ ...base, tin_number: "1000123456", vat_number: "V-1234" }, { accountType: "company" }).errors, []);
    assert.ok(validateCompanyInfo({ ...base, legal_rep_id_types: ["bogus"] }, { accountType: "individual" }).errors.length > 0);
});

test("validateShippingInfo: same-as-business copies the business address, ignoring posted fields", () => {
    const { data, errors } = validateShippingInfo(
        { ship_same_as_business: true, ship_address_line1: "ignored" },
        { businessAddress: bizAddress }
    );
    assert.deepEqual(errors, []);
    assert.equal(data.ship_address_line1, "Plot 9");
    assert.equal(data.ship_region, "Central");
});

test("validateShippingInfo: same-as-business with no business address is rejected", () => {
    const { errors } = validateShippingInfo({ ship_same_as_business: true }, { businessAddress: null });
    assert.ok(errors.length > 0);
});

test("validateShippingInfo: return address is optional but can't be half-filled", () => {
    const ship = { ship_address_line1: "A", ship_city: "B", ship_region: "C" };
    assert.deepEqual(validateShippingInfo(ship, { businessAddress: null }).errors, []);
    assert.ok(validateShippingInfo({ ...ship, return_address_line2: "x" }, { businessAddress: null }).errors.length > 0);
});

test("validateAdditionalInfo validates only the fields sent", () => {
    assert.deepEqual(validateAdditionalInfo({ has_existing_shop: "no", seller_types: ["retailer"] }).errors, []);
    assert.ok(validateAdditionalInfo({ seller_types: [] }).errors.length > 0);
    assert.ok(validateAdditionalInfo({ primary_category_id: 99 }, { validCategoryIds: [1, 2] }).errors.length > 0);
    assert.ok(validateAdditionalInfo({ sourcing_method: "smuggling" }).errors.length > 0);
    assert.ok(validateAdditionalInfo({}).errors.length > 0);
});

test("paymentStepComplete ignores rejected instruments", () => {
    assert.equal(paymentStepComplete([{ status: "rejected" }]), false);
    assert.equal(paymentStepComplete([{ status: "rejected" }, { status: "pending" }]), true);
});

test("companyStepComplete requires TIN certificate for company accounts", () => {
    const kyc = {
        legal_rep_full_name: "Ann", legal_rep_id_types: ["passport"],
        business_address_line1: "Plot 9", business_city: "Kampala", business_region: "Central",
        has_tin: true, has_vat: true
    };
    assert.equal(companyStepComplete({ accountType: "company", kyc, documentTypes: [] }), false);
    assert.equal(companyStepComplete({ accountType: "company", kyc, documentTypes: ["tax_certificate"] }), true);
    assert.equal(companyStepComplete({ accountType: "individual", kyc: { ...kyc, has_tin: false, has_vat: false }, documentTypes: [] }), true);
});

test("computeShopSetupSteps: nothing on file -> all pending", () => {
    const r = computeShopSetupSteps({ accountType: "individual", profile: null, kyc: null, documentTypes: [], instruments: [] });
    assert.equal(r.completed_count, 0);
    assert.equal(r.all_completed, false);
    assert.deepEqual(r.steps.map((s) => s.key), ["shop", "company", "shipping", "payment", "additional"]);
});

test("computeShopSetupSteps: everything filled -> all completed", () => {
    const profile = {
        ...fullShop, ship_address_line1: "A", ship_city: "B", ship_region: "C",
        has_existing_shop: false, seller_types: ["retailer"], primary_category_id: 1,
        sourcing_method: "import", sells_offline: true, uses_other_channels: false
    };
    const kyc = {
        legal_rep_full_name: "Ann", legal_rep_id_types: ["national_id"],
        business_address_line1: "Plot 9", business_city: "Kampala", business_region: "Central"
    };
    const r = computeShopSetupSteps({ accountType: "individual", profile, kyc, documentTypes: [], instruments: [{ status: "approved" }] });
    assert.equal(r.all_completed, true);
});
