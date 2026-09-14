// Statement PDF generator (Phase 4).
//
// Layout matches Jumia's Vendor Center statement panel:
//   Header (logo + statement number + cycle dates)
//   Vendor block (name, owner, phone, MoMo)
//   Opening Balance
//   Line items table
//   CLOSING BALANCE
//   PAYOUT
//   Footer (payment method, dispute window, contact)
//
// Pure function - no DB, no HTTP. Returns a Promise<Buffer>.

const PDFDocument = require("pdfkit");
const path = require("path");
const { statementNumber } = require("./statementNumber");

const BRAND_NAVY = "#16264f";
const BRAND_GREEN = "#059669";
const BRAND_RED = "#dc2626";
const GREY_TEXT = "#6b7280";
const GREY_LINE = "#e5e7eb";

const LOGO_PATH = path.resolve(__dirname, "..", "..", "client", "images", "logo", "lizimas-store-logo.jpg");

// Format UGX value with suffix, matching Jumia: "561,060.00 UGX"
function formatMoney(n, currency) {
    const num = Number(n) || 0;
    const abs = Math.abs(num).toLocaleString("en-UG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return (num < 0 ? "-" : "") + abs + " " + (currency || "UGX");
}

function formatDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

// PAID / UNPAID - what the vendor sees. Everything except paid shows as
// UNPAID in Beat 1 (pending, approved, failed, rolled_forward). Rejected
// shows as UNPAID too, since the vendor needs to know it's not been paid.
function displayStatus(internalStatus) {
    if (internalStatus === "paid") return "PAID";
    return "UNPAID";
}

function displayStatusColor(internalStatus) {
    if (internalStatus === "paid") return BRAND_GREEN;
    return "#c99a00";
}

// Main generator. Options object shape:
//   { statement, lines, vendor, cycle }
// All fields passed in, no DB access.
function generateStatementPdf(opts) {
    return new Promise((resolve, reject) => {
        try {
            const statement = opts.statement;
            const lines = opts.lines || [];
            const vendor = opts.vendor || {};
            const cycle = opts.cycle || {};

            const doc = new PDFDocument({ size: "A4", margin: 50 });
            const chunks = [];
            doc.on("data", (c) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const currency = statement.currency || "UGX";
            const stmtNo = statementNumber({
                vendorId: vendor.id,
                periodEnd: cycle.period_end || statement.created_at
            });

            // ---- Header ----
            try {
                doc.image(LOGO_PATH, 50, 48, { width: 70 });
            } catch (imgErr) {
                // Fall back to text if the logo file is missing.
                doc.fillColor(BRAND_NAVY).fontSize(18).font("Helvetica-Bold")
                   .text("LIZIMAS", 50, 55);
            }

            doc.fillColor(BRAND_NAVY).fontSize(10).font("Helvetica-Bold")
               .text("LIZIMAS STORE", 130, 52);
            doc.fontSize(8).font("Helvetica").fillColor(GREY_TEXT)
               .text("Kampala, Uganda", 130, 68)
               .text("support@lizimasstore.com", 130, 80);

            // Right side: statement identifier
            doc.fillColor(BRAND_NAVY).fontSize(14).font("Helvetica-Bold")
               .text("VENDOR STATEMENT", 300, 52, { width: 245, align: "right" });
            doc.fontSize(10).font("Helvetica").fillColor(GREY_TEXT)
               .text(stmtNo, 300, 72, { width: 245, align: "right" })
               .text("Cycle: " + formatDate(cycle.period_start) + " - " + formatDate(cycle.period_end),
                     300, 86, { width: 245, align: "right" });

            // Status pill
            const statusLabel = displayStatus(statement.status);
            const statusColor = displayStatusColor(statement.status);
            doc.fillColor(statusColor).fontSize(10).font("Helvetica-Bold")
               .text(statusLabel, 300, 104, { width: 245, align: "right" });

            // Divider
            doc.moveTo(50, 145).lineTo(545, 145).strokeColor(BRAND_NAVY).lineWidth(1.5).stroke();

            // ---- Vendor block ----
            doc.fillColor(BRAND_NAVY).fontSize(11).font("Helvetica-Bold").text("Vendor", 50, 162);
            doc.fontSize(10).font("Helvetica").fillColor("#111")
               .text(vendor.business_name || "-", 50, 180)
               .text("Owner: " + (vendor.owner_name || "-"), 50, 196)
               .text("Phone: " + (vendor.phone || "-"), 50, 212)
               .text("MoMo: " + (vendor.momo_number || "-"), 50, 228);

            doc.fillColor(GREY_TEXT).fontSize(9).font("Helvetica")
               .text("Issued: " + formatDate(statement.created_at), 300, 180, { width: 245, align: "right" })
               .text("Currency: " + currency, 300, 196, { width: 245, align: "right" });

            // ---- Opening Balance band ----
            let y = 270;
            doc.rect(50, y, 495, 32).fillColor("#f9fafb").fill();
            doc.fillColor("#111").fontSize(11).font("Helvetica-Bold")
               .text("Opening Balance", 62, y + 10);
            doc.fillColor("#111").fontSize(11).font("Helvetica-Bold")
               .text(formatMoney(statement.opening_balance, currency), 300, y + 10, { width: 233, align: "right" });
            y += 50;

            // ---- Line items ----
            if (lines.length > 0) {
                doc.fontSize(11).font("Helvetica-Bold").fillColor(BRAND_NAVY)
                   .text("Transactions", 50, y);
                y += 20;

                doc.fontSize(9).font("Helvetica-Bold").fillColor(GREY_TEXT);
                doc.text("Type", 55, y);
                doc.text("Description", 155, y);
                doc.text("Amount", 320, y, { width: 220, align: "right" });
                y += 14;
                doc.moveTo(50, y).lineTo(545, y).strokeColor(GREY_LINE).lineWidth(0.5).stroke();
                y += 8;

                doc.fontSize(9).font("Helvetica").fillColor("#111");
                for (const line of lines) {
                    if (y > 700) {
                        doc.addPage();
                        y = 60;
                    }
                    const typeLabel = String(line.line_type || "").replace(/_/g, " ");
                    const desc = line.description || "";
                    const amountStr = formatMoney(line.amount, currency);

                    doc.fillColor("#111").text(typeLabel, 55, y, { width: 95 });
                    doc.fillColor(GREY_TEXT).text(desc, 155, y, { width: 160 });
                    doc.fillColor("#111").text(amountStr, 320, y, { width: 220, align: "right" });
                    y += 15;
                }

                y += 10;
            }

            // ---- Closing Balance + Payout (Jumia's key numbers) ----
            const summaryY = Math.max(y, 620);
            doc.moveTo(50, summaryY).lineTo(545, summaryY).strokeColor(GREY_LINE).lineWidth(1).stroke();

            doc.fillColor("#111").fontSize(12).font("Helvetica-Bold")
               .text("CLOSING BALANCE", 50, summaryY + 14);
            doc.fillColor("#111").fontSize(12).font("Helvetica-Bold")
               .text(formatMoney(statement.amount_due, currency), 320, summaryY + 14, { width: 225, align: "right" });

            doc.moveTo(50, summaryY + 40).lineTo(545, summaryY + 40).strokeColor(GREY_LINE).lineWidth(0.5).stroke();

            doc.fillColor("#111").fontSize(12).font("Helvetica-Bold")
               .text("PAYOUT", 50, summaryY + 52);
            doc.fillColor("#111").fontSize(12).font("Helvetica-Bold")
               .text(formatMoney(statement.amount_due, currency), 320, summaryY + 52, { width: 225, align: "right" });

            // ---- Footer ----
            const footerY = 780;
            doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor(GREY_LINE).lineWidth(0.5).stroke();

            doc.fontSize(8).font("Helvetica").fillColor(GREY_TEXT)
               .text("Payment method: MTN MoMo " + (vendor.momo_number || "not on file"),
                     50, footerY + 8, { width: 495, align: "center" })
               .text("Disputes accepted within 90 days of cycle end. Questions? support@lizimasstore.com",
                     50, footerY + 20, { width: 495, align: "center" });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { generateStatementPdf };
