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

function renderStatementsFull() {
    const root = document.getElementById("vendor-statements-root");
    if (!root || !vendorStatementsState.data) return;
    const d = vendorStatementsState.data;

    root.innerHTML = `
        <div style="display:flex; justify-content:flex-end; margin-bottom:14px;">
            <button onclick="downloadAllStatementsCsv()" style="background:#f59e0b; color:#fff; border:none; border-radius:8px; padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer;">Export Transactions</button>
        </div>

        ${renderStatementsCards(d)}

        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <span style="font-size:11px; font-weight:700; color:#6b7280; letter-spacing:.5px;">STATUS:</span>
                ${renderFilterChip("all", "ALL")}
                ${renderFilterChip("open", "OPEN")}
                ${renderFilterChip("paid", "PAID")}
                ${renderFilterChip("unpaid", "UNPAID")}
            </div>
            <div style="display:flex; gap:6px; align-items:center; margin-left:auto;">
                <span style="font-size:11px; font-weight:700; color:#6b7280; letter-spacing:.5px;">CURRENCY:</span>
                <span title="USD payouts are coming soon" style="padding:4px 10px; border-radius:999px; background:#f3f4f6; color:#9ca3af; font-size:12px; font-weight:600;">USD</span>
                <span style="padding:4px 10px; border-radius:999px; background:#16264f; color:#fff; font-size:12px; font-weight:600;">LOCAL (UGX)</span>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: minmax(260px, 340px) 1fr; gap:16px; align-items:start;">
            <div>${renderStatementsList(d)}</div>
            <div>${renderStatementsDetail(d)}</div>
        </div>
    `;
}

function renderStatementsCards(d) {
    const c = d.currency || "UGX";
    const cards = [
        { label: "Due & Unpaid", value: vsFormatMoney(d.metrics.due_and_unpaid, c), highlight: d.metrics.due_and_unpaid > 0 },
        { label: "Open Statement", value: vsFormatMoney(d.metrics.open_statement_estimated, c), highlight: false },
        { label: "Paid in the last 3 months", value: vsFormatMoney(d.metrics.paid_last_3_months, c), highlight: false }
    ];
    return `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:18px;">
            ${cards.map(card => `
                <div style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:18px;">
                    <div style="font-size:22px; font-weight:800; color:${card.highlight ? "#16264f" : "#111"}; margin-bottom:6px;">${vendorEsc(card.value)}</div>
                    <div style="font-size:12.5px; color:#6b7280;">${vendorEsc(card.label)}</div>
                </div>
            `).join("")}
        </div>
    `;
}

function renderFilterChip(key, label) {
    const active = vendorStatementsState.filter === key;
    const style = active
        ? "background:#16264f; color:#fff; border:none; padding:5px 12px; border-radius:999px; font-size:12px; font-weight:700; cursor:pointer;"
        : "background:#f3f4f6; color:#374151; border:1px solid #d1d5db; padding:5px 12px; border-radius:999px; font-size:12px; font-weight:600; cursor:pointer;";
    return '<button onclick="setStatementsFilter(\'' + key + '\')" style="' + style + '">' + label + "</button>";
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

function renderStatementsList(d) {
    const filtered = filterStatements(d.statements);
    const current = d.currentCycle;

    let rows = "";

    // Open cycle card (if any) always shows at top
    if (current && (vendorStatementsState.filter === "all" || vendorStatementsState.filter === "open")) {
        rows += `
            <div style="border:2px solid #f59e0b; border-radius:8px; padding:14px; margin-bottom:10px; background:#fffbeb;">
                <div style="font-size:13px; font-weight:700; color:#92400e; margin-bottom:4px;">OPEN</div>
                <div style="font-size:13.5px; font-weight:600; margin-bottom:4px;">${vendorEsc(vsFormatPeriod(current.period_start, current.period_end))}</div>
                <div style="font-size:11.5px; color:#6b7280; margin-bottom:6px;">Closes in ${current.daysRemaining} day${current.daysRemaining === 1 ? "" : "s"}</div>
                <div style="font-size:15px; font-weight:800; color:#16264f;">${vendorEsc(vsFormatMoney(current.estimatedAmount, current.currency))}</div>
            </div>
        `;
    }

    if (filtered.length === 0 && !(current && (vendorStatementsState.filter === "all" || vendorStatementsState.filter === "open"))) {
        rows += '<div style="padding:30px 20px; text-align:center; color:#9ca3af; font-size:13px;">No statements in this filter.</div>';
    } else {
        rows += filtered.map(s => {
            const selected = s.id === vendorStatementsState.selectedStatementId;
            const st = vsStatusStyle(s.display_status);
            const border = selected ? "2px solid #16264f" : "1px solid #e5e7eb";
            return `
                <div onclick="selectStatement(${s.id})" style="border:${border}; border-radius:8px; padding:14px; margin-bottom:10px; background:#fff; cursor:pointer;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:13.5px; font-weight:600; margin-bottom:4px;">${vendorEsc(vsFormatPeriod(s.period_start, s.period_end))}</div>
                            <div style="font-size:11.5px; color:#6b7280; margin-bottom:6px; word-break:break-all;">${vendorEsc(s.statement_number)}</div>
                            <div style="display:inline-flex; align-items:center; gap:5px; background:${st.bg}; color:${st.fg}; padding:3px 8px; border-radius:999px; font-size:10.5px; font-weight:700;">
                                <span style="width:6px; height:6px; border-radius:50%; background:${st.dot};"></span>
                                ${vendorEsc(s.display_status)}
                            </div>
                        </div>
                        <div style="font-size:13.5px; font-weight:700; color:#111; white-space:nowrap;">
                            ${vendorEsc(vsFormatMoney(s.amount_due, s.currency))}
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    }

    return `<div>${rows}</div>`;
}

function renderStatementsDetail(d) {
    const id = vendorStatementsState.selectedStatementId;
    const s = d.statements.find(x => x.id === id);

    if (!s) {
        // No statement selected - show the current open cycle summary if there is one
        if (d.currentCycle) {
            const c = d.currentCycle;
            return `
                <div style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:20px;">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
                        <div>
                            <div style="font-size:16px; font-weight:700; margin-bottom:4px;">${vendorEsc(vsFormatPeriod(c.period_start, c.period_end))}</div>
                            <div style="font-size:12px; color:#6b7280;">Open cycle - closes in ${c.daysRemaining} day${c.daysRemaining === 1 ? "" : "s"}</div>
                        </div>
                        <span style="background:#fef3c7; color:#92400e; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700;">OPEN</span>
                    </div>
                    <div style="border-top:1px solid #e5e7eb; padding-top:14px;">
                        <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:10px;">
                            <span>Estimated amount</span><strong>${vendorEsc(vsFormatMoney(c.estimatedAmount, c.currency))}</strong>
                        </div>
                        <div style="font-size:12px; color:#9ca3af;">This estimate updates as orders are delivered. A final statement will be generated when the cycle closes.</div>
                    </div>
                </div>
            `;
        }
        return '<div style="padding:60px 20px; text-align:center; color:#9ca3af; font-size:13px; border:1px dashed #e5e7eb; border-radius:10px;">Select a statement to view details.</div>';
    }

    const st = vsStatusStyle(s.display_status);

    return `
        <div style="background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:20px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:16px; font-weight:700; margin-bottom:4px;">${vendorEsc(vsFormatPeriod(s.period_start, s.period_end))}</div>
                    <div style="font-size:12px; color:#6b7280;">${vendorEsc(s.statement_number)}</div>
                </div>
                <span style="background:${st.bg}; color:${st.fg}; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700;">${vendorEsc(s.display_status)}</span>
            </div>

            <div style="border-top:1px solid #e5e7eb; padding-top:14px; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
                    <span>Opening Balance</span><span>${vendorEsc(vsFormatMoney(s.opening_balance, s.currency))}</span>
                </div>
            </div>

            <div style="border-top:1px solid #e5e7eb; padding-top:14px; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
                    <span>Earnings</span><span>${vendorEsc(vsFormatMoney(s.earnings, s.currency))}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
                    <span>Marketplace charges</span><span>-${vendorEsc(vsFormatMoney(s.commissions, s.currency))}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;">
                    <span>Refunds</span><span>-${vendorEsc(vsFormatMoney(s.refund_deductions, s.currency))}</span>
                </div>
                ${s.adjustments !== 0 ? `<div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:8px;"><span>Adjustments</span><span>${vendorEsc(vsFormatMoney(s.adjustments, s.currency))}</span></div>` : ""}
            </div>

            <div style="border-top:2px solid #16264f; padding-top:14px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; color:#16264f;">
                    <span>CLOSING BALANCE</span><span>${vendorEsc(vsFormatMoney(s.amount_due, s.currency))}</span>
                </div>
            </div>

            <div style="border-top:1px solid #e5e7eb; padding-top:14px; margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:800; color:#16264f;">
                    <span>PAYOUT</span><span>${vendorEsc(vsFormatMoney(s.amount_due, s.currency))}</span>
                </div>
                ${s.paid_at ? '<div style="font-size:12px; color:#6b7280; margin-top:6px;">Paid on ' + vendorEsc(vsFormatDate(s.paid_at)) + "</div>" : ""}
            </div>

            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button onclick="downloadStatement('pdf', ${s.id})" style="background:#f59e0b; color:#fff; border:none; border-radius:8px; padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer;">Download all transactions</button>
                <button onclick="downloadStatement('csv', ${s.id})" style="background:#fff; color:#16264f; border:1px solid #16264f; border-radius:8px; padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer;">CSV</button>
                <button onclick="shareStatement(${s.id})" style="background:#fff; color:#16264f; border:1px solid #16264f; border-radius:8px; padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer;">Share</button>
            </div>
        </div>
    `;
}

// --- Actions -----------------------------------------------------------

window.downloadStatement = async function (kind, id) {
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

window.downloadAllStatementsCsv = function () {
    // Simplified: downloads the current selected statement's CSV.
    // A full async export batch would be Beat 2b.
    const id = vendorStatementsState.selectedStatementId;
    if (!id) { alert("Select a statement to export."); return; }
    window.downloadStatement("csv", id);
};
