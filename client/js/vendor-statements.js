// Phase 4 Beat 2 - Vendor Account Statements view.
//
// Mounted at #vendor-statements-root inside the Wallet tab when the
// vendor clicks the "Statements" sub-tab. Replaces the standalone wallet
// layout with the Jumia-style list + detail split.
//
// Depends on:
//   - vendorAuthorizedFetch() and vendorEsc() from vendor-dashboard.js
//   - formatUgx() - local helper (Jumia-style currency suffix)

let vendorStatementsState = {
    loaded: false,
    loading: false,
    data: null,
    filter: "all",          // all | open | paid | unpaid
    selectedStatementId: null
};

// Format: "561,060.00 UGX" - Jumia-style suffix, not prefix.
function vsFormatMoney(amount, currency) {
    const n = Number(amount) || 0;
    const abs = Math.abs(n).toLocaleString("en-UG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return (n < 0 ? "-" : "") + abs + " " + (currency || "UGX");
}

// Short date: "14 Sep 2026"
function vsFormatDate(d) {
    if (!d) return "-";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Short period label: "14 – 20 Sep 2026" (compresses the month/year)
function vsFormatPeriod(start, end) {
    if (!start || !end) return "-";
    const s = new Date(start);
    const e = new Date(end);
    const sameMonth = s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear();
    if (sameMonth) {
        return s.getUTCDate() + " - " + e.getUTCDate() + " " +
               e.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    }
    return vsFormatDate(start) + " - " + vsFormatDate(end);
}

// Status pill style. PAID = green, UNPAID = amber, REJECTED = red.
function vsStatusStyle(displayStatus) {
    if (displayStatus === "PAID") {
        return { bg: "#dcfce7", fg: "#166534", dot: "#22c55e" };
    }
    if (displayStatus === "REJECTED") {
        return { bg: "#fee2e2", fg: "#991b1b", dot: "#dc2626" };
    }
    return { bg: "#fef3c7", fg: "#92400e", dot: "#eab308" };
}

// --- Sub-tab switcher (called by the buttons in dashboard.html) ---------

window.switchWalletSubTab = function (which) {
    const section = document.getElementById("tab-wallet");
    if (section) section.classList.toggle("vs-statements-mode", which === "statements");
    const walletView = document.getElementById("wallet-subview-wallet");
    const statementsView = document.getElementById("wallet-subview-statements");
    const btnWallet = document.getElementById("wallet-subtab-wallet");
    const btnStatements = document.getElementById("wallet-subtab-statements");
    if (!walletView || !statementsView) return;

    const activeStyle = "background:none; border:none; padding:10px 14px; font-size:14px; font-weight:600; color:#16264f; cursor:pointer; border-bottom:2px solid #16264f; margin-bottom:-1px;";
    const inactiveStyle = "background:none; border:none; padding:10px 14px; font-size:14px; font-weight:600; color:#6b7280; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px;";

    if (which === "statements") {
        walletView.style.display = "none";
        statementsView.style.display = "block";
        btnWallet.setAttribute("style", inactiveStyle);
        btnStatements.setAttribute("style", activeStyle);
        if (!vendorStatementsState.loaded && !vendorStatementsState.loading) {
            loadVendorStatementsView();
        }
    } else {
        statementsView.style.display = "none";
        walletView.style.display = "block";
        btnStatements.setAttribute("style", inactiveStyle);
        btnWallet.setAttribute("style", activeStyle);
    }
};

// --- Main renderer -----------------------------------------------------

async function loadVendorStatementsView() {
    const root = document.getElementById("vendor-statements-root");
    if (!root) return;
    vendorStatementsState.loading = true;
    root.innerHTML = '<div style="padding:40px; text-align:center; color:#6b7280;">Loading statements...</div>';

    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/statements");
        if (data.error) {
            root.innerHTML = '<p style="padding:20px; color:#dc2626;">' + vendorEsc(data.error) + "</p>";
            vendorStatementsState.loading = false;
            return;
        }
        vendorStatementsState.data = data;
        vendorStatementsState.loaded = true;
        vendorStatementsState.loading = false;

        // Auto-select the newest statement if none selected
        if (!vendorStatementsState.selectedStatementId && data.statements.length > 0) {
            vendorStatementsState.selectedStatementId = data.statements[0].id;
        }

        renderStatementsFull();
    } catch (error) {
        console.error("Load vendor statements error:", error);
        root.innerHTML = '<p style="padding:20px; color:#dc2626;">Could not load statements.</p>';
        vendorStatementsState.loading = false;
    }
}

// Phase 4 Beat 2 Mobile - injects the media query this view needs exactly
// once per page load. Everything here is otherwise inline-styled (matching
// the rest of vendor-dashboard.js), and an inline style attribute always
// wins the cascade over a plain stylesheet rule - so the rules that need
// to win at phone width use !important, scoped tightly to the two classes
// below rather than applied broadly.
function ensureVendorStatementsResponsiveStyles() {
    if (document.getElementById("vs-responsive-style")) return;
    const style = document.createElement("style");
    style.id = "vs-responsive-style";
    style.textContent = `
        @media (max-width: 720px) {
            .vs-main-grid {
                grid-template-columns: 1fr !important;
            }
            .vs-filter-row {
                margin-left: 0 !important;
            }
        }
    `;
    document.head.appendChild(style);
}

function renderStatementsFull() {
    const root = document.getElementById("vendor-statements-root");
    if (!root || !vendorStatementsState.data) return;
    ensureVendorStatementsResponsiveStyles();
    const d = vendorStatementsState.data;

    root.innerHTML = `
        <div class="vs-crumb"><span class="vs-crumb-muted">Account Statements</span> <span class="vs-crumb-sep">&gt;</span> <span class="vs-crumb-on" title="Your Seller ID">${vendorEsc(d.seller_id || "Seller ID not set")}</span></div>
        <div class="vs-head">
            <h2 class="vs-title">Account Statements</h2>
            <button type="button" class="vs-export-btn" onclick="downloadAllStatementsCsv()">Export Transactions</button>
        </div>

        ${renderStatementsCards(d)}

        <div class="vs-filterbar">
            <div class="vs-filter-group" role="group" aria-label="Status">
                <span class="vs-filter-label">Status:</span>
                ${renderFilterChip("all", "ALL")}
                ${renderFilterChip("open", "OPEN")}
                ${renderFilterChip("paid", "PAID")}
                ${renderFilterChip("unpaid", "UNPAID")}
            </div>
            <div class="vs-filter-group vs-filter-row vs-currency" role="radiogroup" aria-label="Currency">
                <span class="vs-filter-label">Currency:</span>
                ${renderCurrencyChip(d.currency, "USD", "USD")}
                ${renderCurrencyChip(d.currency, "UGX", "LOCAL")}
            </div>
        </div>

        <div class="vs-main-grid">
            <div>${renderStatementsList(d)}</div>
            <div>${renderStatementsDetail(d)}</div>
        </div>

        <div class="vs-exports-card">
            <h3 class="vs-exports-title">Transactions Exports</h3>
            <div id="vs-exports"><div class="vs-exports-empty">Loading...</div></div>
        </div>
    `;
    loadTransactionExports();
}

// --- Transactions Exports (migrations/129_vendor_transaction_exports.sql) --
const vsExports = { page: 1, limit: 5 };
const VS_EXPORT_TYPE = { statement_pdf: "Statement transactions (PDF)", statement_csv: "Statement transactions (CSV)", all_transactions: "All transactions (CSV)" };

async function loadTransactionExports() {
    const host = document.getElementById("vs-exports");
    if (!host) return;
    try {
        const data = await vendorAuthorizedFetch(`/api/vendors/me/transaction-exports?page=${vsExports.page}&limit=${vsExports.limit}`);
        if (data.error) { host.innerHTML = `<div class="vs-exports-empty">${vendorEsc(data.error)}</div>`; return; }
        const rows = data.exports || [];
        const total = Number(data.total) || 0;
        const pages = Math.max(1, Math.ceil(total / vsExports.limit));
        const start = (vsExports.page - 1) * vsExports.limit;
        const when = (v) => new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const btn = (label, page, off, icon) => `<button type="button" class="vs-pg" aria-label="${label}" ${off ? "disabled" : ""} onclick="vsExportsPage(${page})">${icon}</button>`;
        host.innerHTML = `<div class="vs-exports-scroll"><table class="vs-exports-table">
            <thead><tr><th>Type</th><th>Requested</th><th>Created</th><th>Status</th><th class="vs-right">Download</th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
                <td>${vendorEsc(VS_EXPORT_TYPE[r.kind] || r.kind)}</td>
                <td>${vendorEsc(r.requested || "")}</td>
                <td>${vendorEsc(when(r.created_at))}</td>
                <td><span class="vs-export-status vs-export-${vendorEsc(r.status)}">${r.status === "ready" ? "Ready" : "Failed"}</span></td>
                <td class="vs-right">${r.status === "ready" ? `<button type="button" class="vs-dl" onclick="vsDownloadExport('${vendorEsc(r.kind)}', ${r.statement_id == null ? "null" : Number(r.statement_id)})">Download</button>` : ""}</td>
            </tr>`).join("") || '<tr><td colspan="5" class="vs-exports-empty">No exports to display.</td></tr>'}</tbody>
        </table></div>
        <div class="vs-exports-pager"><span>Items per page: ${vsExports.limit}</span><span>${total ? `${start + 1} – ${start + rows.length} of ${total}` : "0 of 0"}</span>
            <span class="vs-pg-group">${btn("First page", 1, vsExports.page <= 1, "|&lsaquo;")}${btn("Previous page", vsExports.page - 1, vsExports.page <= 1, "&lsaquo;")}${btn("Next page", vsExports.page + 1, vsExports.page >= pages, "&rsaquo;")}${btn("Last page", pages, vsExports.page >= pages, "&rsaquo;|")}</span></div>`;
    } catch (error) {
        console.error("loadTransactionExports error:", error);
        host.innerHTML = '<div class="vs-exports-empty">Could not load exports.</div>';
    }
}

window.vsExportsPage = function (p) { vsExports.page = p; loadTransactionExports(); };

async function recordTransactionExport(kind, statementId) {
    try {
        await vendorAuthorizedFetch("/api/vendors/me/transaction-exports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, statement_id: statementId })
        });
        vsExports.page = 1;
        loadTransactionExports();
    } catch (e) { console.error("recordTransactionExport error:", e); }
}

async function vsFetchDownload(url, filename) {
    const res = await fetch(url, { headers: { "Authorization": "Bearer " + getVendorToken() } });
    if (!res.ok) {
        let msg = "Could not download.";
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) { /* not json */ }
        throw new Error(msg);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Download button on an exports row - rebuilds the same file, no new row.
window.vsDownloadExport = async function (kind, statementId) {
    try {
        if (kind === "all_transactions") await vsFetchDownload("/api/vendors/me/transactions/export.csv", `all-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
        else await window.downloadStatement(kind === "statement_csv" ? "csv" : "pdf", statementId, { record: false });
    } catch (e) { alert(e.message); }
};

// Phase 4 Beat 3 - clickable currency chip. Active currency is highlighted;
// clicking the inactive one updates the vendor's preferred_currency and
// reloads the whole statements view (only affects statements generated
// AFTER this change - already-closed statements keep their own locked
// currency, same as vendors.preferred_currency behaves server-side).
function renderCurrencyChip(activeCurrency, code, label) {
    const isActive = (activeCurrency || "UGX") === code;
    return `<label class="vs-radio"><input type="radio" name="vs-currency" value="${code}"${isActive ? " checked" : ""} onchange="setVendorPreferredCurrency('${code}')"><span></span>${vendorEsc(label)}</label>`;
}

window.setVendorPreferredCurrency = async function (currency) {
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/currency", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferred_currency: currency })
        });
        if (data.error) {
            alert(data.error);
            return;
        }
        await loadVendorStatementsView();
    } catch (error) {
        console.error("setVendorPreferredCurrency error:", error);
        alert("Could not update currency preference. Please try again.");
    }
};

function renderStatementsCards(d) {
    const c = d.currency || "UGX";
    const cards = [
        { label: "Due & Unpaid", value: vsFormatMoney(d.metrics.due_and_unpaid, c) },
        { label: "Open Statement", value: vsFormatMoney(d.metrics.open_statement_estimated, c) },
        { label: "Paid in the last 3 months", value: vsFormatMoney(d.metrics.paid_last_3_months, c) }
    ];
    return `<div class="vs-cards">${cards.map((card) => `<div class="vs-card"><div class="vs-card-value">${vendorEsc(card.value)}</div><div class="vs-card-label">${vendorEsc(card.label)}</div></div>`).join("")}</div>`;
}

function renderFilterChip(key, label) {
    const active = vendorStatementsState.filter === key;
    return `<button type="button" class="vs-chip vs-chip-${key}${active ? " vs-chip-on" : ""}" aria-pressed="${active}" onclick="setStatementsFilter('${key}')">${key === "all" ? "" : '<span class="vs-dot"></span>'}${label}</button>`;
}

window.setStatementsFilter = function (key) {
    vendorStatementsState.filter = key;
    renderStatementsFull();
};

window.selectStatement = function (id) {
    vendorStatementsState.selectedStatementId = id;
    renderStatementsFull();
};

function filterStatements(statements) {
    const f = vendorStatementsState.filter;
    if (f === "all") return statements;
    if (f === "open") return []; // open cycle shown separately, no rows here
    if (f === "paid") return statements.filter(s => s.display_status === "PAID");
    if (f === "unpaid") return statements.filter(s => s.display_status !== "PAID" && s.display_status !== "REJECTED");
    return statements;
}

const VS_FLAG_UG = '<svg class="vs-flag" viewBox="0 0 18 12" width="18" height="12" aria-label="Uganda" role="img"><rect width="18" height="2" y="0" fill="#000"/><rect width="18" height="2" y="2" fill="#fcdc04"/><rect width="18" height="2" y="4" fill="#d90000"/><rect width="18" height="2" y="6" fill="#000"/><rect width="18" height="2" y="8" fill="#fcdc04"/><rect width="18" height="2" y="10" fill="#d90000"/><circle cx="9" cy="6" r="2.2" fill="#fff"/></svg>';

function renderStatementsList(d) {
    const filtered = filterStatements(d.statements);
    const current = d.currentCycle;
    const showOpen = current && (vendorStatementsState.filter === "all" || vendorStatementsState.filter === "open");
    let rows = "";
    if (showOpen) {
        const sel = vendorStatementsState.selectedStatementId === null;
        rows += `<button type="button" class="vs-row${sel ? " vs-row-on" : ""}" onclick="selectStatement(null)">
            <span class="vs-row-main"><span class="vs-row-period">${vendorEsc(vsFormatPeriod(current.period_start, current.period_end))}</span>
            <span class="vs-row-meta">${VS_FLAG_UG}<span>Closes in ${current.daysRemaining} day${current.daysRemaining === 1 ? "" : "s"}</span><span class="vs-status vs-status-open"><span class="vs-dot"></span>OPEN</span></span></span>
            <span class="vs-row-pay">${vendorEsc(vsFormatMoney(current.estimatedAmount, current.currency))}</span>
        </button>`;
    }
    if (!filtered.length && !showOpen) {
        rows += '<div class="vs-list-empty">No statements in this filter.</div>';
    } else {
        rows += filtered.map((s) => {
            const sel = s.id === vendorStatementsState.selectedStatementId;
            const cls = s.display_status === "PAID" ? "paid" : s.display_status === "REJECTED" ? "rejected" : "unpaid";
            return `<button type="button" class="vs-row${sel ? " vs-row-on" : ""}" onclick="selectStatement(${s.id})">
                <span class="vs-row-main"><span class="vs-row-period">${vendorEsc(vsFormatPeriod(s.period_start, s.period_end))}</span>
                <span class="vs-row-meta">${VS_FLAG_UG}<span class="vs-row-no">${vendorEsc(s.statement_number)}</span><span class="vs-status vs-status-${cls}"><span class="vs-dot"></span>${vendorEsc(s.display_status)}</span></span></span>
                <span class="vs-row-pay">${vendorEsc(vsFormatMoney(s.amount_due, s.currency))}</span>
            </button>`;
        }).join("");
    }
    return `<div class="vs-list"><div class="vs-list-head"><span>Period / Number / Status</span><span>Payout</span></div>${rows}</div>`;
}

function renderStatementsDetail(d) {
    const id = vendorStatementsState.selectedStatementId;
    const s = d.statements.find((x) => x.id === id);
    const line = (label, value, strong) => `<div class="vs-line${strong ? " vs-line-strong" : ""}"><span>${label}</span><span>${value}</span></div>`;

    if (!s) {
        if (d.currentCycle) {
            const c = d.currentCycle;
            return `<div class="vs-detail">
                <div class="vs-detail-head"><div class="vs-detail-period">${vendorEsc(vsFormatPeriod(c.period_start, c.period_end))}</div>
                <div class="vs-detail-meta"><span>Open cycle - closes in ${c.daysRemaining} day${c.daysRemaining === 1 ? "" : "s"}</span><span class="vs-status vs-status-open"><span class="vs-dot"></span>OPEN</span></div></div>
                ${line("Estimated amount", vendorEsc(vsFormatMoney(c.estimatedAmount, c.currency)))}
                <div class="vs-detail-note">This estimate updates as orders are delivered. The final statement is generated when the cycle closes.</div>
            </div>`;
        }
        return '<div class="vs-detail vs-detail-empty">Select a statement to view details.</div>';
    }

    const cls = s.display_status === "PAID" ? "paid" : s.display_status === "REJECTED" ? "rejected" : "unpaid";
    const money = (v) => vendorEsc(vsFormatMoney(v, s.currency));
    return `<div class="vs-detail">
        <div class="vs-detail-head">
            <div class="vs-detail-period">${vendorEsc(vsFormatPeriod(s.period_start, s.period_end))}</div>
            <div class="vs-detail-meta"><span>${vendorEsc(s.statement_number)}</span><span class="vs-status vs-status-${cls}"><span class="vs-dot"></span>${vendorEsc(s.display_status)}</span></div>
        </div>
        ${line("Opening Balance", money(s.opening_balance))}
        <div class="vs-detail-body">
            ${line("Earnings", money(s.earnings))}
            ${line("Marketplace charges", "-" + money(s.commissions))}
            ${line("Refunds", "-" + money(s.refund_deductions))}
            ${Number(s.adjustments) !== 0 ? line("Adjustments", money(s.adjustments)) : ""}
        </div>
        <div class="vs-detail-foot">
            ${line("CLOSING BALANCE", money(s.amount_due), true)}
            ${line("PAYOUT", money(s.amount_due), true)}
            ${s.paid_at ? `<div class="vs-detail-note">Paid on ${vendorEsc(vsFormatDate(s.paid_at))}</div>` : ""}
            <div class="vs-detail-actions">
                <button type="button" class="vs-btn-outline" onclick="shareStatement(${s.id})">Share</button>
                <button type="button" class="vs-btn-outline" onclick="downloadStatement('csv', ${s.id})">CSV</button>
                <button type="button" class="vs-export-btn" onclick="downloadStatement('pdf', ${s.id})">Download all transactions</button>
            </div>
        </div>
    </div>`;
}

// --- Actions -----------------------------------------------------------

window.downloadStatement = async function (kind, id, opts) {
    const record = !(opts && opts.record === false);
    try {
        const token = getVendorToken();
        const url = kind === "csv"
            ? "/api/vendors/me/statements/" + id + "/csv"
            : "/api/vendors/me/statements/" + id + "/pdf";
        const res = await fetch(url, {
            headers: { "Authorization": "Bearer " + token }
        });
        if (!res.ok) {
            alert("Could not download statement.");
            return;
        }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "statement-" + id + (kind === "csv" ? ".csv" : ".pdf");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        if (record) recordTransactionExport(kind === "csv" ? "statement_csv" : "statement_pdf", id);
    } catch (error) {
        console.error("Download statement error:", error);
        alert("Could not download statement.");
    }
};

window.shareStatement = async function (id) {
    if (!confirm("Generate a shareable link for this statement? It expires in 30 days.")) return;
    try {
        const data = await vendorAuthorizedFetch("/api/vendors/me/statements/" + id + "/share", { method: "POST" });
        if (data.error) { alert(data.error); return; }
        const full = (data.full_url && data.full_url.startsWith("http")) ? data.full_url : (window.location.origin + data.share_url);
        try {
            await navigator.clipboard.writeText(full);
            alert("Shareable link copied to clipboard:\n\n" + full);
        } catch (e) {
            prompt("Copy this link:", full);
        }
    } catch (error) {
        console.error("Share statement error:", error);
        alert("Could not generate share link.");
    }
};

// Export Transactions - every statement's transactions in one CSV.
window.downloadAllStatementsCsv = async function () {
    try {
        await vsFetchDownload("/api/vendors/me/transactions/export.csv", `all-transactions-${new Date().toISOString().slice(0, 10)}.csv`);
        recordTransactionExport("all_transactions", null);
    } catch (e) { alert(e.message); }
};
