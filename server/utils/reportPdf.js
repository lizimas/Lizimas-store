// Required lazily (inside buildPerformanceReportPdf) rather than at module
// load time: this file is required from analyticsController.js, which in
// turn is required by the main route table, so a top-level require would
// take the whole server down on boot if "npm install" hasn't been run yet
// after this dependency was added. Lazy-loading confines that failure to
// just the PDF report endpoints until the package is installed.

const NAVY = "#0f1b3d";
const GOLD = "#f5c518";

function ugxFmt(n) {
    return "UGX " + Math.round(Number(n) || 0).toLocaleString("en-UG");
}

function fmtDate(d) {
    return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Builds a single-recipient performance report PDF and resolves to a Buffer.
 * Only ever includes ONE vendor's or ONE staff member's own products - this
 * is the report handed to that person, so it must never leak anyone else's
 * numbers.
 *
 * entity: {
 *   label: string,            // business name or staff name - the report's headline
 *   subLabel: string,         // owner name (vendor) or role (staff)
 *   kind: "Vendor" | "Staff Member",
 *   summary: { productCount, productViews, unitsSold, revenue, ordersCount },
 *   products: [{ name, views, cartAdds, unitsSold, revenue }]
 * }
 * range: { start: Date, end: Date }
 */
function buildPerformanceReportPdf(entity, range) {
    return new Promise((resolve, reject) => {
        try {
            const PDFDocument = require("pdfkit");
            const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
            const chunks = [];
            doc.on("data", (c) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const pageW = doc.page.width;
            const pageH = doc.page.height;
            const marginX = 40;
            const contentW = pageW - marginX * 2;

            // ---- Header band ----
            doc.rect(0, 0, pageW, 92).fill(NAVY);
            doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(20).text("LIZIMAS STORE", marginX, 26);
            doc.fillColor("#ffffff").font("Helvetica").fontSize(11).text("Performance Report", marginX, 52);
            doc.fillColor("#c9cddb").fontSize(9).text(
                `${fmtDate(range.start)}  -  ${fmtDate(range.end)}`, marginX, 70
            );

            // ---- Recipient ----
            let y = 112;
            doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text(entity.label, marginX, y, { width: contentW });
            y += 20;
            const subLabelText = entity.subLabel ? `${entity.kind} - ${entity.subLabel}` : entity.kind;
            doc.fillColor("#666666").font("Helvetica").fontSize(10).text(subLabelText, marginX, y, { width: contentW });
            y += 26;

            // ---- Summary stat cards ----
            const stats = [
                ["PRODUCTS", String(entity.summary.productCount)],
                ["PRODUCT VIEWS", entity.summary.productViews.toLocaleString()],
                ["UNITS SOLD", entity.summary.unitsSold.toLocaleString()],
                ["ORDERS", String(entity.summary.ordersCount)],
                ["REVENUE", ugxFmt(entity.summary.revenue)]
            ];
            const gap = 8;
            const boxW = (contentW - gap * (stats.length - 1)) / stats.length;
            const boxH = 50;
            stats.forEach((s, i) => {
                const x = marginX + i * (boxW + gap);
                doc.roundedRect(x, y, boxW, boxH, 4).fillAndStroke("#f4f5f7", "#e5e7eb");
                doc.fillColor("#888888").font("Helvetica").fontSize(7.5)
                    .text(s[0], x + 8, y + 8, { width: boxW - 16 });
                doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12.5)
                    .text(s[1], x + 8, y + 23, { width: boxW - 16, ellipsis: true });
            });
            y += boxH + 26;

            // ---- Per-product table ----
            doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text("Your Products", marginX, y);
            y += 18;

            const cols = [
                { label: "Product", width: contentW - 65 - 78 - 80 - 110 },
                { label: "Views", width: 65, align: "right" },
                { label: "Cart Adds", width: 78, align: "right" },
                { label: "Units Sold", width: 80, align: "right" },
                { label: "Revenue (UGX)", width: 110, align: "right" }
            ];
            const rowH = 22;

            function drawTableHeader(yy) {
                doc.rect(marginX, yy, contentW, rowH).fill(NAVY);
                let x = marginX;
                doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
                cols.forEach((c) => {
                    doc.text(c.label, x + 6, yy + 7, { width: c.width - 12, align: c.align || "left" });
                    x += c.width;
                });
                return yy + rowH;
            }

            function ensureRoom(yy) {
                if (yy + rowH > pageH - 56) {
                    doc.addPage();
                    return drawTableHeader(40);
                }
                return yy;
            }

            y = drawTableHeader(y);

            if (!entity.products.length) {
                doc.font("Helvetica").fontSize(9.5).fillColor("#888888")
                    .text("No product activity in this range yet.", marginX + 6, y + 8);
                y += 28;
            } else {
                entity.products.forEach((p, i) => {
                    y = ensureRoom(y);
                    if (i % 2 === 1) doc.rect(marginX, y, contentW, rowH).fill("#f7f7f9");
                    doc.font("Helvetica").fontSize(9).fillColor("#222222");
                    let x = marginX;
                    const cells = [
                        p.name,
                        p.views.toLocaleString(),
                        p.cartAdds.toLocaleString(),
                        p.unitsSold.toLocaleString(),
                        Number(p.revenue).toLocaleString()
                    ];
                    cols.forEach((c, ci) => {
                        doc.text(cells[ci], x + 6, y + 6, {
                            width: c.width - 12,
                            align: c.align || "left",
                            ellipsis: ci === 0
                        });
                        x += c.width;
                    });
                    y += rowH;
                });
            }

            // ---- Footer on every page ----
            const range_ = doc.bufferedPageRange();
            for (let i = range_.start; i < range_.start + range_.count; i++) {
                doc.switchToPage(i);
                doc.font("Helvetica").fontSize(7.5).fillColor("#999999").text(
                    `Generated ${new Date().toLocaleString("en-GB")} - Lizimas Store admin dashboard. ` +
                    `This report covers only ${entity.kind === "Vendor" ? "this vendor's" : "this staff member's"} own products for the selected period.`,
                    marginX, pageH - 34, { width: contentW }
                );
            }

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { buildPerformanceReportPdf };
