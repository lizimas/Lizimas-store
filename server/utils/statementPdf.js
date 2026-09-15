// Statement PDF generator (Phase 4) - compact single-page layout.
//
// Fits header, vendor block, Opening Balance, itemized transactions,
// CLOSING BALANCE, PAYOUT and footer on ONE A4 portrait page for
// statements with up to ~25 line items. Longer statements auto-flow to
// page 2 rather than overflowing.
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

const MARGIN = 36;
const LEFT = MARGIN;
const RIGHT = 595.28 - MARGIN;   // A4 width in points minus margin
const CENTER = (LEFT + RIGHT) / 2;
const PAGE_HEIGHT = 841.89;      // A4 height in points
const BOTTOM_LIMIT = PAGE_HEIGHT - MARGIN;

function formatMoney(n, currency) {
    const num = Number(n) || 0;
    const abs = Math.abs(num).toLocaleString("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (num < 0 ? "-" : "") + abs + " " + (currency || "UGX");
}

function formatDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function displayStatus(internalStatus) {
    if (internalStatus === "paid") return "PAID";
    return "UNPAID";
}

function displayStatusColor(internalStatus) {
    if (internalStatus === "paid") return BRAND_GREEN;
    return "#c99a00";
}

function generateStatementPdf(opts) {
    return new Promise((resolve, reject) => {
        try {
            const statement = opts.statement;
            const lines = opts.lines || [];
            const vendor = opts.vendor || {};
            const cycle = opts.cycle || {};

            const doc = new PDFDocument({ size: "A4", margin: MARGIN });
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
                doc.image(LOGO_PATH, LEFT, MARGIN, { width: 42 });
            } catch (imgErr) {
                doc.fillColor(BRAND_NAVY).fontSize(14).font("Helvetica-Bold")
                   .text("LIZIMAS STORE", LEFT, MARGIN);
            }

            doc.fillColor(BRAND_NAVY).fontSize(9).font("Helvetica-Bold")
               .text("LIZIMAS STORE", LEFT + 52, MARGIN + 2);
            doc.fontSize(7).font("Helvetica").fillColor(GREY_TEXT)
               .text("Kampala, Uganda", LEFT + 52, MARGIN + 15)
               .text("support@lizimasstore.com", LEFT + 52, MARGIN + 25);

            // Right side: statement identifier
            doc.fillColor(BRAND_NAVY).fontSize(13).font("Helvetica-Bold")
               .text("VENDOR STATEMENT", 300, MARGIN + 2, { width: RIGHT - 300, align: "right" });
            doc.fontSize(9).font("Helvetica").fillColor(GREY_TEXT)
               .text(stmtNo, 300, MARGIN + 20, { width: RIGHT - 300, align: "right" })
               .text("Cycle: " + formatDate(cycle.period_start) + " - " + formatDate(cycle.period_end),
                     300, MARGIN + 32, { width: RIGHT - 300, align: "right" });

            const statusLabel = displayStatus(statement.status);
            const statusColor = displayStatusColor(statement.status);
            doc.fillColor(statusColor).fontSize(9).font("Helvetica-Bold")
               .text(statusLabel, 300, MARGIN + 46, { width: RIGHT - 300, align: "right" });

            // Divider
            let y = MARGIN + 66;
            doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(BRAND_NAVY).lineWidth(1).stroke();
            y += 10;

            // ---- Vendor block (2-column, compact) ----
            doc.fillColor(BRAND_NAVY).fontSize(10).font("Helvetica-Bold").text("Vendor", LEFT, y);
            doc.fillColor("#111").fontSize(8.5).font("Helvetica")
               .text(vendor.business_name || "-", LEFT, y + 13)
               .text("Owner: " + (vendor.owner_name || "-"), LEFT, y + 24)
               .text("Phone: " + (vendor.phone || "-") + "   MoMo: " + (vendor.momo_number || "-"), LEFT, y + 35);

            doc.fillColor(GREY_TEXT).fontSize(8).font("Helvetica")
               .text("Issued: " + formatDate(statement.created_at), 340, y + 13, { width: RIGHT - 340, align: "right" })
               .text("Currency: " + currency, 340, y + 24, { width: RIGHT - 340, align: "right" });
            y += 52;

            // ---- Opening Balance band ----
            doc.rect(LEFT, y, RIGHT - LEFT, 20).fillColor("#f9fafb").fill();
            doc.fillColor("#111").fontSize(9.5).font("Helvetica-Bold")
               .text("Opening Balance", LEFT + 8, y + 5.5);
            doc.fillColor("#111").fontSize(9.5).font("Helvetica-Bold")
               .text(formatMoney(statement.opening_balance, currency), 300, y + 5.5, { width: RIGHT - 308, align: "right" });
            y += 28;

            // ---- Transactions ----
            if (lines.length > 0) {
                doc.fontSize(10).font("Helvetica-Bold").fillColor(BRAND_NAVY)
                   .text("Transactions", LEFT, y);
                y += 14;

                doc.fontSize(8).font("Helvetica-Bold").fillColor(GREY_TEXT);
                doc.text("Type", LEFT + 4, y);
                doc.text("Description", LEFT + 100, y);
                doc.text("Amount", 300, y, { width: RIGHT - 308, align: "right" });
                y += 10;
                doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(GREY_LINE).lineWidth(0.5).stroke();
                y += 5;

                doc.fontSize(8).font("Helvetica");
                for (const line of lines) {
                    if (y > BOTTOM_LIMIT - 120) {
                        doc.addPage();
                        y = MARGIN;
                    }
                    const typeLabel = String(line.line_type || "").replace(/_/g, " ");
                    const desc = String(line.description || "").slice(0, 48);
                    const amountStr = formatMoney(line.amount, currency);

                    doc.fillColor("#111").text(typeLabel, LEFT + 4, y, { width: 92, lineBreak: false });
                    doc.fillColor(GREY_TEXT).text(desc, LEFT + 100, y, { width: 195, lineBreak: false });
                    doc.fillColor("#111").text(amountStr, 300, y, { width: RIGHT - 308, align: "right", lineBreak: false });
                    y += 11;
                }
                y += 6;
            }

            // ---- CLOSING BALANCE + PAYOUT (bottom-anchored if space allows) ----
            const remaining = BOTTOM_LIMIT - y - 90;
            const summaryY = remaining > 0 ? BOTTOM_LIMIT - 90 : y + 10;

            doc.moveTo(LEFT, summaryY).lineTo(RIGHT, summaryY).strokeColor(GREY_LINE).lineWidth(1).stroke();

            doc.fillColor("#111").fontSize(10.5).font("Helvetica-Bold")
               .text("CLOSING BALANCE", LEFT, summaryY + 8);
            doc.fillColor("#111").fontSize(10.5).font("Helvetica-Bold")
               .text(formatMoney(statement.amount_due, currency), 300, summaryY + 8, { width: RIGHT - 308, align: "right" });

            doc.moveTo(LEFT, summaryY + 26).lineTo(RIGHT, summaryY + 26).strokeColor(GREY_LINE).lineWidth(0.5).stroke();

            doc.fillColor("#111").fontSize(10.5).font("Helvetica-Bold")
               .text("PAYOUT", LEFT, summaryY + 34);
            doc.fillColor("#111").fontSize(10.5).font("Helvetica-Bold")
               .text(formatMoney(statement.amount_due, currency), 300, summaryY + 34, { width: RIGHT - 308, align: "right" });

            // ---- Footer (single line, no wrap) ----
            const footerY = BOTTOM_LIMIT - 14;
            doc.moveTo(LEFT, footerY).lineTo(RIGHT, footerY).strokeColor(GREY_LINE).lineWidth(0.5).stroke();
            doc.fontSize(7).font("Helvetica").fillColor(GREY_TEXT)
               .text("Payment: MTN MoMo " + (vendor.momo_number || "not on file") + "  |  Disputes within 90 days  |  support@lizimasstore.com",
                     LEFT, footerY + 4, { width: RIGHT - LEFT, align: "center", lineBreak: false });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { generateStatementPdf };
