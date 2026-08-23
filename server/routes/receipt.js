const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const pool = require("../config/database");

const SECRET = process.env.RECEIPT_SECRET || process.env.JWT_SECRET || "change-me";

function sign(orderId) {
  return crypto.createHmac("sha256", SECRET)
    .update("receipt:" + orderId).digest("hex").slice(0, 32);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ugx(n) {
  return "UGX " + Number(n || 0).toLocaleString("en-UG");
}

router.get("/receipt/:orderId", async (req, res) => {
  const id = parseInt(req.params.orderId, 10);
  const t = String(req.query.t || "");
  if (!id || t !== sign(id)) return res.status(403).send("Invalid receipt link.");

  try {
    const o = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
    if (!o.rows.length) return res.status(404).send("Receipt not found.");
    const items = await pool.query(
      "SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [id]
    );
    res.send(renderReceipt(o.rows[0], items.rows));
  } catch (e) {
    console.error("Receipt render failed:", e);
    res.status(500).send("Could not load receipt.");
  }
});

module.exports = router;
module.exports.sign = sign;

const STORE = {
  name: "LIZIMAS STORE",
  tagline: "Quality You Love, Service You Trust.",
  address: "Central Region, Kampala, Uganda",
  phone: "+256 792 363 104",
  email: "support@lizimasstore.com",
  web: "www.lizimasstore.com"
};

function renderReceipt(o, items) {
  const created = new Date(o.paid_at || o.created_at);
  const date = created.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const time = created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const subtotal = Number(o.subtotal != null ? o.subtotal
    : items.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0));
  const discount = Number(o.discount_amount || 0);
  const tax = Number(o.tax_amount || 0);
  const fee = Number(o.delivery_fee || 0);
  const total = Number(o.total || 0);
  const paid = Number(o.amount_paid || 0);
  const balance = total - paid;

  const rows = items.map(function (i) {
    const bits = [i.variant_color, i.variant_size].filter(Boolean).join(" / ");
    return `<tr>
      <td class="p-img">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : ""}</td>
      <td><div class="p-name">${esc(i.product_name)}</div>
          ${bits ? `<div class="p-var">${esc(bits)}</div>` : ""}
          ${i.sku ? `<div class="p-var">SKU: ${esc(i.sku)}</div>` : ""}</td>
      <td class="c">${Number(i.quantity)}</td>
      <td class="r">${ugx(i.price)}</td>
      <td class="r">${ugx(Number(i.price) * Number(i.quantity))}</td>
    </tr>`;
  }).join("");

  const money = [
    ["Subtotal (Items)", ugx(subtotal), ""],
    discount > 0 ? ["Discount" + (o.discount_code ? ` (${esc(o.discount_code)})` : ""), "-" + ugx(discount), "g"] : null,
    ["Tax (VAT)", ugx(tax), tax === 0 ? "g" : ""],
    ["Delivery Fee", ugx(fee), ""]
  ].filter(Boolean).map(r => `<div class="mrow ${r[2]}"><span>${r[0]}</span><span>${r[1]}</span></div>`).join("");

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Receipt ${esc(o.receipt_number || "#" + o.id)} - Lizimas Store</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:16px;background:#f4f5f7;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a}
.sheet{max-width:820px;margin:0 auto;background:#fff;padding:28px;border-radius:6px}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start}
.logo{width:120px;height:120px;background:#f5c518;border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;color:#0f1b3d;flex-shrink:0}
.logo b{font-size:2rem}.logo span{font-size:.6rem;margin-top:6px;letter-spacing:.5px}
.brand h1{margin:0;font-size:2rem;letter-spacing:1px;color:#0f1b3d}
.brand .tag{color:#555;font-size:.9rem;margin:2px 0 8px}
.brand .line{height:2px;background:#f5c518;width:180px;margin-bottom:8px}
.brand p{margin:2px 0;font-size:.8rem;color:#444}
.rbox{text-align:right;font-size:.8rem}
.rtag{display:inline-block;background:#0f1b3d;color:#fff;padding:8px 22px;border-radius:4px;font-weight:700;letter-spacing:1px;margin-bottom:10px}
.rbox div{margin:3px 0}.rbox b{color:#0f1b3d}
h3{font-size:.8rem;letter-spacing:1px;color:#0f1b3d;border-bottom:2px solid #f5c518;padding-bottom:4px;display:inline-block;margin:22px 0 10px}
.cols{display:flex;gap:32px;flex-wrap:wrap}.cols>div{flex:1;min-width:230px}
.kv{font-size:.85rem;margin:5px 0}.kv b{display:inline-block;min-width:74px;color:#555;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:.85rem;margin-top:6px}
th{background:#0f1b3d;color:#fff;padding:9px;text-align:left;font-size:.72rem;letter-spacing:.5px}
td{padding:9px;border-bottom:1px solid #eee;vertical-align:top}
.p-img{width:86px}.p-img img{width:78px;height:78px;object-fit:cover;border-radius:4px}
.p-name{font-weight:700;color:#0f1b3d}.p-var{color:#666;font-size:.78rem;margin-top:2px}
.c{text-align:center}.r{text-align:right;white-space:nowrap}
.pay{display:flex;gap:24px;flex-wrap:wrap;margin-top:18px}
.pay>div{flex:1;min-width:250px}
.mrow{display:flex;justify-content:space-between;font-size:.85rem;padding:5px 0}
.mrow.g span:last-child{color:#1a8f3c}
.mtot{display:flex;justify-content:space-between;font-weight:800;color:#0f1b3d;border-top:2px solid #0f1b3d;padding-top:8px;margin-top:4px}
.card{background:#fdf6e0;border:1px solid #f5c518;border-radius:6px;padding:14px}
.card .mrow{font-weight:600}.card .big{font-size:1.05rem;font-weight:800;color:#0f1b3d}
.foot{border-top:1px dashed #ccc;margin-top:26px;padding-top:16px;font-size:.78rem;color:#555}
.foot b{color:#0f1b3d}
.printbtn{display:block;width:100%;margin:0 0 18px;padding:11px;background:#0f1b3d;color:#f5c518;border:none;border-radius:6px;font-size:.9rem;font-weight:700;cursor:pointer}
@media print{body{background:#fff;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}.sheet{padding:0}.printbtn{display:none}}
@media(max-width:640px){
body{padding:8px}.sheet{padding:16px}
.top{flex-direction:column}.rbox{text-align:left;width:100%}
.brand h1{font-size:1.4rem}.logo{width:84px;height:84px}.logo b{font-size:1.4rem}.logo span{font-size:.45rem}
table,tbody,tr,td{display:block;width:100%}
table tr:first-child{display:none}
tr{border:1px solid #eee;border-radius:6px;margin-bottom:10px;padding:10px;position:relative}
td{border:none;padding:3px 0}
.p-img{width:auto}.p-img img{width:64px;height:64px}
.c,.r{text-align:left}
.c:before{content:"Qty: ";color:#666}
td:nth-child(4):before{content:"Unit: ";color:#666}
td:nth-child(5):before{content:"Subtotal: ";color:#666;font-weight:600}
td:nth-child(5){font-weight:700;color:#0f1b3d}
.pay>div{min-width:0}
.cols{display:block}.cols>div{min-width:0}
h3{margin:16px 0 6px;font-size:.72rem}
.kv{font-size:.8rem;margin:3px 0}.kv b{min-width:66px}
.brand p{font-size:.75rem;margin:1px 0}
.brand .tag{font-size:.8rem;margin:2px 0 6px}
.rtag{padding:5px 14px;font-size:.8rem;margin:10px 0 6px}
.rbox{font-size:.75rem}.rbox div{margin:2px 0}
.p-name{font-size:.85rem}
.foot{font-size:.72rem;margin-top:18px}
}
</style></head><body><div class="sheet">

<button class="printbtn" onclick="window.print()">Download / Print PDF</button>

<div class="top">
  <div style="display:flex;gap:16px;flex-wrap:wrap">
    <div class="logo"><b>LS</b><span>LIZIMAS STORE</span></div>
    <div class="brand">
      <h1>${STORE.name}</h1>
      <div class="tag">${STORE.tagline}</div><div class="line"></div>
      <p>${STORE.address}</p><p>${STORE.phone}</p><p>${STORE.email}</p><p>${STORE.web}</p>
    </div>
  </div>
  <div class="rbox">
    <div class="rtag">RECEIPT</div>
    <div><b>Receipt No.:</b> ${esc(o.receipt_number || "Pending")}</div>
    <div><b>Order No.:</b> #${o.id}</div>
    <div><b>Date:</b> ${date}</div>
    <div><b>Time:</b> ${time}</div>
  </div>
</div>

<div class="cols">
  <div>
    <h3>CUSTOMER DETAILS</h3>
    <div class="kv"><b>Name:</b> ${esc(o.customer_name)}</div>
    <div class="kv"><b>Phone:</b> ${esc(o.phone)}</div>
    ${o.customer_email ? `<div class="kv"><b>Email:</b> ${esc(o.customer_email)}</div>` : ""}
  </div>
  <div>
    <h3>ORDER SUMMARY</h3>
    <div class="kv"><b>Payment:</b> ${esc(o.payment_method)}</div>
    <div class="kv"><b>Delivery:</b> ${o.delivery_method === "pickup" ? "Self Pickup" : "Home Delivery"}</div>
    <div class="kv"><b>Status:</b> ${esc(String(o.status || "").toUpperCase())}</div>
  </div>
</div>

<h3>DELIVERY ADDRESS</h3>
<div class="kv" style="max-width:520px">${esc(o.delivery_address)}</div>

<h3>ORDER ITEMS</h3>
<table>
  <tr><th>PRODUCT</th><th>DESCRIPTION</th><th class="c">QTY</th><th class="r">UNIT PRICE</th><th class="r">SUBTOTAL</th></tr>
  ${rows}
</table>

<h3>PAYMENT BREAKDOWN</h3>
<div class="pay">
  <div>
    ${money}
    <div class="mtot"><span>ORDER TOTAL</span><span>${ugx(total)}</span></div>
  </div>
  <div class="card">
    <div class="mrow big"><span>TOTAL DUE</span><span>${ugx(total)}</span></div>
    <div class="mrow"><span>Amount Paid</span><span>${ugx(paid)}</span></div>
    <div class="mrow ${balance <= 0 ? "g" : ""}"><span>Balance</span><span>${ugx(balance)}</span></div>
  </div>
</div>

<div class="foot">
  <b>THANK YOU!</b> Thank you for shopping with Lizimas Store. We appreciate your business and look forward to serving you again.
  <div style="margin-top:8px">${STORE.phone} &nbsp;&middot;&nbsp; ${STORE.email} &nbsp;&middot;&nbsp; ${STORE.web}</div>
</div>

</div></body></html>`;
}
