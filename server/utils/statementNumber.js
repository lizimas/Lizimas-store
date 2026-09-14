// Statement number formatter (Phase 4).
//
// Format: UG{VENDOR_ID_PADDED}-{YYYYMMDD}
//   - UG           country prefix (Uganda)
//   - VENDOR_ID    4-digit zero-padded vendor id (UG0004)
//   - YYYYMMDD     cycle period_end date (20260914)
//
// Example: vendor id 4, cycle ending 2026-09-14 -> "UG0004-20260914"

function statementNumber({ vendorId, periodEnd }) {
    const vid = Number(vendorId);
    if (!Number.isInteger(vid) || vid <= 0) return "UG0000-00000000";

    let ymd;
    if (/^\d{8}$/.test(String(periodEnd))) {
        ymd = String(periodEnd);
    } else {
        const d = new Date(periodEnd);
        if (isNaN(d.getTime())) {
            return "UG" + String(vid).padStart(4, "0") + "-00000000";
        }
        const pad = (n) => String(n).padStart(2, "0");
        ymd = "" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
    }

    return "UG" + String(vid).padStart(4, "0") + "-" + ymd;
}

module.exports = { statementNumber };
