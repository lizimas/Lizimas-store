// Vendor shop-setup onboarding (mobile Home "Let's take your shop live!",
// Ryan Sept 2026's seller onboarding).
//
// One read endpoint that returns everything the Home checklist and its
// five step forms need, plus one write endpoint per vendor-editable step:
//   Shop Information     -> PATCH /api/vendors/me/shop-setup/shop-info
//   Company Information  -> PATCH /api/vendors/me/shop-setup/company
//   Shipping Information -> PATCH /api/vendors/me/shop-setup/shipping
//   Additional Info      -> PATCH /api/vendors/me/shop-setup/additional
// Payment Information reuses the existing payment-instrument endpoints
// (vendorPaymentInstrumentsController.js), and the TIN certificate on the
// Company step reuses the existing KYC document upload
// (vendorKycController.js) - no second copy of either rule set.
//
// Step completion is derived from real data on every read (see
// server/utils/vendorShopSetup.js), never stored.

const pool = require("../config/database");
const { encryptField, decryptField, hashForLookup } = require("../utils/encryption");
const { canVendorEditKyc, requiredDocumentTypesForKyc, KYC_DOCUMENT_LABELS } = require("../utils/vendorKyc");
const {
    LEGAL_REP_ID_TYPES, LEGAL_REP_ID_TYPE_LABELS, DEFAULT_COUNTRY,
    SELLER_TYPES, SELLER_TYPE_LABELS, SOURCING_METHODS, SOURCING_METHOD_LABELS,
    businessAddressFromKyc, validateShopInfo, validateCompanyInfo, validateShippingInfo, validateAdditionalInfo,
    computeShopSetupSteps
} = require("../utils/vendorShopSetup");

async function loadVendor(vendorId) {
    const { rows } = await pool.query(
        `SELECT v.id, v.business_name, v.account_type, v.phone, v.status, v.rejection_reason,
                v.shop_id, v.policies_accepted_at, v.policies_version, v.submitted_at,
                u.email AS account_email, u.name AS owner_name
         FROM vendors v JOIN users u ON u.id = v.user_id
         WHERE v.id = $1`,
        [vendorId]
    );
    return rows[0] || null;
}

// Top-level storefront categories - the "primary product type" choices.
async function loadTopCategories() {
    const { rows } = await pool.query(
        `SELECT id, name FROM categories
         WHERE parent_id IS NULL AND is_active = true
         ORDER BY display_order ASC, id ASC`
    );
    return rows;
}

async function loadKyc(vendorId) {
    const { rows } = await pool.query(
        `SELECT kyc_status, tin_number_enc, vat_number_enc, requires_work_permit,
                legal_rep_full_name, legal_rep_id_types,
                business_address_line1, business_address_line2, business_city,
                business_region, business_postal_code, business_country
         FROM vendor_kyc WHERE vendor_id = $1`,
        [vendorId]
    );
    return rows[0] || null;
}

exports.getMyShopSetup = async (req, res) => {
    try {
        const vendor = await loadVendor(req.vendorId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const [profileRes, kyc, docRes, instRes, categories] = await Promise.all([
            pool.query("SELECT * FROM vendor_shop_profile WHERE vendor_id = $1", [vendor.id]),
            loadKyc(vendor.id),
            pool.query(
                `SELECT document_type, original_filename, uploaded_at, review_status, rejection_reason, action_required_reason
                 FROM vendor_kyc_documents WHERE vendor_id = $1`,
                [vendor.id]
            ),
            pool.query(
                `SELECT id, method, momo_number, bank_name, account_number, account_holder_name,
                        status, rejection_reason, is_preferred, evidence_cloudinary_public_id IS NOT NULL AS has_evidence
                 FROM vendor_payment_instruments WHERE vendor_id = $1 ORDER BY created_at DESC`,
                [vendor.id]
            ),
            loadTopCategories()
        ]);

        const profile = profileRes.rows[0] || null;
        const documents = docRes.rows;
        const documentTypes = documents.map((d) => d.document_type);
        const kycStatus = kyc ? kyc.kyc_status : "not_started";
        const requiredDocs = requiredDocumentTypesForKyc({
            accountType: vendor.account_type,
            requiresWorkPermit: kyc ? kyc.requires_work_permit : false
        });

        // Decrypted for the vendor themselves only - same rule as getMyKyc.
        const tin = kyc ? decryptField(kyc.tin_number_enc) : null;
        const vat = kyc ? decryptField(kyc.vat_number_enc) : null;

        const setup = computeShopSetupSteps({
            accountType: vendor.account_type,
            profile,
            kyc: kyc ? { ...kyc, has_tin: Boolean(tin), has_vat: Boolean(vat) } : null,
            documentTypes,
            instruments: instRes.rows
        });

        res.json({
            account: {
                email: vendor.account_email,
                phone: vendor.phone,
                country: DEFAULT_COUNTRY,
                account_type: vendor.account_type,
                business_name: vendor.business_name,
                owner_name: vendor.owner_name,
                shop_id: vendor.shop_id,
                status: vendor.status,
                rejection_reason: vendor.rejection_reason,
                submitted_at: vendor.submitted_at,
                policies_accepted_at: vendor.policies_accepted_at,
                policies_version: vendor.policies_version
            },
            profile: profile || { cc_country: DEFAULT_COUNTRY, ship_country: DEFAULT_COUNTRY, return_country: DEFAULT_COUNTRY },
            company: {
                kyc_status: kycStatus,
                editable: canVendorEditKyc(kycStatus),
                tin_number: tin,
                vat_number: vat,
                legal_rep_full_name: kyc ? kyc.legal_rep_full_name : null,
                legal_rep_id_types: kyc && kyc.legal_rep_id_types ? kyc.legal_rep_id_types : [],
                business_address_line1: kyc ? kyc.business_address_line1 : null,
                business_address_line2: kyc ? kyc.business_address_line2 : null,
                business_city: kyc ? kyc.business_city : null,
                business_region: kyc ? kyc.business_region : null,
                business_postal_code: kyc ? kyc.business_postal_code : null,
                business_country: (kyc && kyc.business_country) || DEFAULT_COUNTRY
            },
            documents,
            required_documents: requiredDocs,
            document_labels: KYC_DOCUMENT_LABELS,
            id_type_options: LEGAL_REP_ID_TYPES.map((code) => ({ code, label: LEGAL_REP_ID_TYPE_LABELS[code] })),
            seller_type_options: SELLER_TYPES.map((code) => ({ code, label: SELLER_TYPE_LABELS[code] })),
            sourcing_options: SOURCING_METHODS.map((code) => ({ code, label: SOURCING_METHOD_LABELS[code] })),
            category_options: categories,
            instruments: instRes.rows,
            ...setup
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateMyShopInfo = async (req, res) => {
    try {
        const vendor = await loadVendor(req.vendorId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { data, errors } = validateShopInfo(req.body || {});
        if (errors.length) return res.status(400).json({ error: errors[0], errors });

        await pool.query(
            `INSERT INTO vendor_shop_profile (
                vendor_id, contact_name, contact_email, contact_phone,
                cc_name, cc_phone, cc_email, cc_address_line1, cc_address_line2,
                cc_city, cc_region, cc_postal_code
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (vendor_id) DO UPDATE SET
                contact_name = $2, contact_email = $3, contact_phone = $4,
                cc_name = $5, cc_phone = $6, cc_email = $7,
                cc_address_line1 = $8, cc_address_line2 = $9, cc_city = $10,
                cc_region = $11, cc_postal_code = $12, updated_at = now()`,
            [vendor.id, data.contact_name, data.contact_email, data.contact_phone,
             data.cc_name, data.cc_phone, data.cc_email, data.cc_address_line1, data.cc_address_line2,
             data.cc_city, data.cc_region, data.cc_postal_code]
        );
        res.json({ message: "Shop information saved." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Company Information. TIN/VAT are stored exactly like updateMyKyc does
// (encrypted + lookup hash, verified-only dedup) but this does NOT flip
// kyc_status to 'submitted' - it's a draft save of one onboarding step;
// the formal KYC submission stays where it is.
//
// While KYC is locked (submitted/under_review/verified/suspended), a
// vendor may still FILL a field that is empty - every vendor was
// backfilled to 'submitted' in Sept 2026 before these fields existed, so
// a hard lock would leave them unable to ever complete this step - but
// can never CHANGE a value already on file.
exports.updateMyCompanyInfo = async (req, res) => {
    try {
        const vendor = await loadVendor(req.vendorId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const { data, errors } = validateCompanyInfo(req.body || {}, { accountType: vendor.account_type });
        if (errors.length) return res.status(400).json({ error: errors[0], errors });

        const kyc = await loadKyc(vendor.id);
        const locked = kyc ? !canVendorEditKyc(kyc.kyc_status) : false;
        const currentTin = kyc ? decryptField(kyc.tin_number_enc) : null;
        const currentVat = kyc ? decryptField(kyc.vat_number_enc) : null;

        if (locked) {
            const changed = [];
            if (currentTin && data.tin_number && data.tin_number !== currentTin) changed.push("TIN");
            if (currentVat && data.vat_number && data.vat_number !== currentVat) changed.push("VAT Number");
            if (kyc.legal_rep_full_name && data.legal_rep_full_name !== kyc.legal_rep_full_name) changed.push("Full Name");
            if (changed.length) {
                return res.status(409).json({
                    error: `${changed.join(", ")} can't be changed while your verification is ${kyc.kyc_status.replace(/_/g, " ")}. Contact support if something needs correcting.`
                });
            }
        }

        const tinHash = data.tin_number ? hashForLookup(data.tin_number) : null;
        const vatHash = data.vat_number ? hashForLookup(data.vat_number) : null;
        for (const [hash, col, label] of [[tinHash, "tin_number_hash", "TIN"], [vatHash, "vat_number_hash", "VAT number"]]) {
            if (!hash) continue;
            const dupe = await pool.query(
                `SELECT 1 FROM vendor_kyc WHERE kyc_status = 'verified' AND vendor_id != $1 AND ${col} = $2`,
                [vendor.id, hash]
            );
            if (dupe.rows.length) {
                return res.status(409).json({ error: `This ${label} is already associated with another verified vendor account.` });
            }
        }

        const tinEnc = data.tin_number ? encryptField(data.tin_number) : null;
        const vatEnc = data.vat_number ? encryptField(data.vat_number) : null;

        // $15 = locked: when true, only NULL columns get filled.
        await pool.query(
            `INSERT INTO vendor_kyc (
                vendor_id, tin_number_enc, tin_number_hash, vat_number_enc, vat_number_hash,
                legal_rep_full_name, legal_rep_id_types,
                business_address_line1, business_address_line2, business_city,
                business_region, business_postal_code
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (vendor_id) DO UPDATE SET
                tin_number_enc = CASE WHEN $13 AND vendor_kyc.tin_number_enc IS NOT NULL THEN vendor_kyc.tin_number_enc ELSE COALESCE($2, vendor_kyc.tin_number_enc) END,
                tin_number_hash = CASE WHEN $13 AND vendor_kyc.tin_number_hash IS NOT NULL THEN vendor_kyc.tin_number_hash ELSE COALESCE($3, vendor_kyc.tin_number_hash) END,
                vat_number_enc = CASE WHEN $13 AND vendor_kyc.vat_number_enc IS NOT NULL THEN vendor_kyc.vat_number_enc ELSE COALESCE($4, vendor_kyc.vat_number_enc) END,
                vat_number_hash = CASE WHEN $13 AND vendor_kyc.vat_number_hash IS NOT NULL THEN vendor_kyc.vat_number_hash ELSE COALESCE($5, vendor_kyc.vat_number_hash) END,
                legal_rep_full_name = CASE WHEN $13 AND vendor_kyc.legal_rep_full_name IS NOT NULL THEN vendor_kyc.legal_rep_full_name ELSE $6 END,
                legal_rep_id_types = $7,
                business_address_line1 = $8,
                business_address_line2 = $9,
                business_city = $10,
                business_region = $11,
                business_postal_code = $12,
                updated_at = now()`,
            [vendor.id, tinEnc, tinHash, vatEnc, vatHash,
             data.legal_rep_full_name, data.legal_rep_id_types,
             data.business_address_line1, data.business_address_line2, data.business_city,
             data.business_region, data.business_postal_code, locked]
        );

        // Keep "same as business address" shipping/return copies in sync
        // with the address just saved.
        await pool.query(
            `UPDATE vendor_shop_profile SET
                ship_address_line1 = CASE WHEN ship_same_as_business THEN $2 ELSE ship_address_line1 END,
                ship_address_line2 = CASE WHEN ship_same_as_business THEN $3 ELSE ship_address_line2 END,
                ship_city = CASE WHEN ship_same_as_business THEN $4 ELSE ship_city END,
                ship_region = CASE WHEN ship_same_as_business THEN $5 ELSE ship_region END,
                ship_postal_code = CASE WHEN ship_same_as_business THEN $6 ELSE ship_postal_code END,
                return_address_line1 = CASE WHEN return_same_as_business THEN $2 ELSE return_address_line1 END,
                return_address_line2 = CASE WHEN return_same_as_business THEN $3 ELSE return_address_line2 END,
                return_city = CASE WHEN return_same_as_business THEN $4 ELSE return_city END,
                return_region = CASE WHEN return_same_as_business THEN $5 ELSE return_region END,
                return_postal_code = CASE WHEN return_same_as_business THEN $6 ELSE return_postal_code END,
                updated_at = now()
             WHERE vendor_id = $1 AND (ship_same_as_business OR return_same_as_business)`,
            [vendor.id, data.business_address_line1, data.business_address_line2, data.business_city,
             data.business_region, data.business_postal_code]
        );

        res.json({ message: "Company information saved." });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "This TIN or VAT number is already associated with another verified vendor account." });
        }
        res.status(500).json({ error: error.message });
    }
};

exports.updateMyShippingInfo = async (req, res) => {
    try {
        const vendor = await loadVendor(req.vendorId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const kyc = await loadKyc(vendor.id);
        const { data, errors } = validateShippingInfo(req.body || {}, { businessAddress: businessAddressFromKyc(kyc) });
        if (errors.length) return res.status(400).json({ error: errors[0], errors });

        await pool.query(
            `INSERT INTO vendor_shop_profile (
                vendor_id, ship_same_as_business, ship_address_line1, ship_address_line2, ship_city,
                ship_region, ship_postal_code, return_same_as_business, return_address_line1,
                return_address_line2, return_city, return_region, return_postal_code
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (vendor_id) DO UPDATE SET
                ship_same_as_business = $2, ship_address_line1 = $3, ship_address_line2 = $4,
                ship_city = $5, ship_region = $6, ship_postal_code = $7,
                return_same_as_business = $8, return_address_line1 = $9, return_address_line2 = $10,
                return_city = $11, return_region = $12, return_postal_code = $13,
                updated_at = now()`,
            [vendor.id, data.ship_same_as_business, data.ship_address_line1, data.ship_address_line2,
             data.ship_city, data.ship_region, data.ship_postal_code, data.return_same_as_business,
             data.return_address_line1, data.return_address_line2, data.return_city,
             data.return_region, data.return_postal_code]
        );
        res.json({ message: "Shipping information saved." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Additional Information - Shop Details and Catalog Details tabs save
// independently; only the columns actually sent are updated.
const ADDITIONAL_COLUMNS = ["has_existing_shop", "existing_shop_names", "new_shop_reason", "seller_types", "primary_category_id", "sourcing_method", "sells_offline", "uses_other_channels"];

exports.updateMyAdditionalInfo = async (req, res) => {
    try {
        const vendor = await loadVendor(req.vendorId);
        if (!vendor) return res.status(404).json({ error: "No vendor profile found for this account." });

        const categories = await loadTopCategories();
        const { data, errors } = validateAdditionalInfo(req.body || {}, { validCategoryIds: categories.map((c) => c.id) });
        if (errors.length) return res.status(400).json({ error: errors[0], errors });

        const cols = ADDITIONAL_COLUMNS.filter((c) => c in data);
        const values = cols.map((c) => data[c]);
        const placeholders = cols.map((_, i) => `$${i + 2}`);
        const updates = cols.map((c, i) => `${c} = $${i + 2}`);

        await pool.query(
            `INSERT INTO vendor_shop_profile (vendor_id, ${cols.join(", ")})
             VALUES ($1, ${placeholders.join(", ")})
             ON CONFLICT (vendor_id) DO UPDATE SET ${updates.join(", ")}, updated_at = now()`,
            [vendor.id, ...values]
        );
        res.json({ message: "Additional information saved." });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
