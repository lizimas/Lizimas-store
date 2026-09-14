// Statement CSV exporter (Phase 4).
//
// Produces a flat CSV any accountant can open in Excel or Sheets. Same
// data as the PDF, different format. Header row uses the statement's
// metadata, then a blank line, then the itemized transactions, then a
// summary block matching the PDF's Opening / CLOSING BALANCE / PAYOUT.

const { statementNumber } = require("./statementNumber");

// Escape a single CSV field: wrap in quotes, double any internal quotes.
function csvField(v) {
    const s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function csvRow(values) {
    return values.map(csvField).join(",") + "\r\n";
}

function formatDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    const pad = (n) => String(n).padStart(2, "0");
    return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
}

function money(n) {
    const num = Number(n) || 0;
    return num.toFixed(2);
}

// Returns a UTF-8 CSV string.
function generateStatementCsv({ statement, lines, vendor, cycle }) {
    const currency = statement.currency || "UGX";
    const stmtNo = statementNumber({
        vendorId: vendor.id,
        periodEnd: cycle.period_end || statement.created_at
    });

    let out = "";

    // ---- Header block ----
    out += csvRow(["Lizimas Store — Vendor Statement"]);
    out += csvRow(["Statement", stmtNo]);
    out += csvRow(["Cycle start", formatDate(cycle.period_start)]);
    out += csvRow(["Cycle end", formatDate(cycle.period_end)]);
    out += csvRow(["Status", statement.status === "paid" ? "PAID" : "UNPAID"]);
    out += csvRow(["Currency", currency]);
    out += csvRow(["Issued", formatDate(statement.created_at)]);
    out += "\r\n";

    // ---- Vendor block ----
    out += csvRow(["Vendor", vendor.business_name || "-"]);
    out += csvRow(["Owner", vendor.owner_name || "-"]);
    out += csvRow(["Phone", vendor.phone || "-"]);
    out += csvRow(["MoMo", vendor.momo_number || "-"]);
    out += "\r\n";

    // ---- Transactions ----
    out += csvRow(["Type", "Description", "Reference", "Amount (" + currency + ")"]);
    for (const line of lines || []) {
        out += csvRow([
            String(line.line_type || "").replace(/_/g, " "),
            line.description || "",
            line.reference_id == null ? "" : line.reference_id,
            money(line.amount)
        ]);
    }
    out += "\r\n";

    // ---- Summary ----
    out += csvRow(["Opening Balance", money(statement.opening_balance)]);
    out += csvRow(["Earnings", money(statement.earnings)]);
    out += csvRow(["Commissions", money(statement.commissions)]);
    out += csvRow(["Refund Deductions", money(statement.refund_deductions)]);
    out += csvRow(["Adjustments", money(statement.adjustments)]);
    out += csvRow(["CLOSING BALANCE", money(statement.amount_due)]);
    out += csvRow(["PAYOUT", money(statement.amount_due)]);

    return out;
}

module.exports = { generateStatementCsv };
