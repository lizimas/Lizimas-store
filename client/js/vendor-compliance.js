// Vendor side of compliance (Oct 2026, Ryan's designs, Lizimas colours):
//  - a banner: red "Shop on hold - upload compliance documents" while held,
//    amber "Upload your required documents" while something is missing or
//    must be uploaded again, green "Account Verified" once everything is
//    approved (can be closed);
//  - a Compliance Status card: "2 of 5 submitted" with a progress bar, or
//    "Fully Verified - 5/5 requirements completed";
//  - shown on Home and at the top of Identity & Business Verification,
//    where "Submit for Review" stays locked until every required document
//    is uploaded.
// Data: GET /api/vendors/me/kyc (hold, documents, uploadable_types).
(function () {
    "use strict";
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const LABELS = () => (typeof KYC_DOCUMENT_LABELS !== "undefined" ? KYC_DOCUMENT_LABELS : {});
    const ICON = {
        alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v6M12 16.5v.5"/>',
        ok: '<circle cx="12" cy="12" r="9.5"/><path d="m7.8 12.3 2.8 2.8 5.6-5.8"/>',
        shield: '<path d="M12 3 5 6v5.5c0 4.3 2.9 8.2 7 9.5 4.1-1.3 7-5.2 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
        arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>',
        lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'
    };
    const ico = (n, s) => `<svg viewBox="0 0 24 24" width="${s || 22}" height="${s || 22}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

    function requiredTypesOf(k) {
        const base = typeof vdRequiredDocumentTypes === "function" ? vdRequiredDocumentTypes(k.account_type, Boolean(k.requires_work_permit)) : (k.required_documents || []);
        return [...new Set([...base, ...((k.hold && k.hold.documents) || [])])];
    }
    function summary(k, types) {
        types = types || requiredTypesOf(k);
        const docs = new Map((k.documents || []).map(d => [d.document_type, d]));
        let submitted = 0, approved = 0, missing = 0, redo = 0;
        types.forEach(t => {
            const d = docs.get(t);
            if (!d) { missing++; return; }
            if (d.review_status === "rejected" || d.review_status === "action_required") { redo++; return; }
            submitted++;
            if (d.review_status === "accepted") approved++;
        });
        const total = types.length;
        const verified = total > 0 && approved === total;
        return { total, submitted, approved, missing, redo, verified, held: !!k.hold, pct: total ? Math.round(submitted / total * 100) : 100 };
    }

    function banner(k, s, where) {
        const goto = where === "home"
            ? `<button type="button" class="vcp-banner-btn" onclick="vmShowScreen('verification')">Upload documents ${ico("arrow", 18)}</button>` : "";
        if (s.held) {
            const docs = ((k.hold && k.hold.documents) || []).map(t => LABELS()[t] || t).join(", ");
            return `<div class="vcp-banner vcp-red" role="alert">${ico("alert", 30)}
                <div class="vcp-banner-text"><strong>Shop on hold &ndash; upload compliance documents</strong>
                <span>Your products are hidden and payouts are paused until Lizimas Store approves: ${esc(docs)}.${k.hold.reason ? " " + esc(k.hold.reason) : ""}
                Everything comes back automatically once they're approved.</span></div>${goto}</div>`;
        }
        if (s.verified) {
            if (where === "home" && vcpDismissed()) return "";
            return `<div class="vcp-banner vcp-green" role="status">${ico("ok", 26)}
                <div class="vcp-banner-text"><strong>Account Verified</strong><span>&mdash; your store is live and visible to customers.</span></div>
                ${where === "home" ? `<button type="button" class="vcp-x" aria-label="Close" onclick="vcpDismiss(this)">${ico("x", 18)}</button>` : ""}</div>`;
        }
        if (s.missing || s.redo) {
            return `<div class="vcp-banner vcp-amber" role="status">${ico("alert", 28)}
                <div class="vcp-banner-text"><strong>Upload your required documents</strong>
                <span>${s.missing ? s.missing + " missing" : ""}${s.missing && s.redo ? " &middot; " : ""}${s.redo ? s.redo + " to upload again" : ""}. Complete them to keep your shop fully active.</span></div>${goto}</div>`;
        }
        return "";
    }
    function card(s) {
        if (s.verified) {
            return `<div class="vcp-card"><div class="vcp-card-head">${ico("shield", 22)} Compliance</div>
                <div class="vcp-verified">Fully Verified</div><div class="vcp-sub">${s.approved}/${s.total} requirements completed</div>
                <div class="vcp-bar"><span style="width:100%"></span></div>
                <div class="vcp-ok-line">${ico("ok", 18)} Your account is fully verified</div></div>`;
        }
        return `<div class="vcp-card"><div class="vcp-card-head">${ico("shield", 22)} Compliance Status</div>
            <div class="vcp-sub">Complete all required documents to ${s.held ? "lift the hold on" : "fully activate"} your account.</div>
            <div class="vcp-progress"><div class="vcp-progress-top"><strong>${s.submitted} of ${s.total} submitted</strong><span class="vcp-pct">${s.pct}%</span></div>
                <div class="vcp-bar"><span style="width:${s.pct}%"></span></div>
                <div class="vcp-progress-foot"><span class="vcp-g">${s.submitted} submitted</span><span class="vcp-r">${s.missing + s.redo} ${s.redo ? "to upload" : "missing"}</span></div></div>
            ${s.submitted > s.approved ? `<div class="vcp-sub">${s.submitted - s.approved} waiting for Lizimas review</div>` : ""}</div>`;
    }

    // Identity & Business Verification panel
    window.vdRenderComplianceTop = function (k, types) {
        const panel = document.getElementById("vendor-kyc-panel");
        if (!panel) return;
        let top = document.getElementById("vendor-compliance-top");
        if (!top) {
            top = document.createElement("div");
            top.id = "vendor-compliance-top";
            const h2 = panel.querySelector("h2");
            const sub = panel.querySelector(".admin-page-subtitle");
            (sub || h2).insertAdjacentElement("afterend", top);
        }
        const s = summary(k, types);
        top.innerHTML = banner(k, s, "panel") + card(s);
        const head = document.querySelector("#vendor-kyc-documents h3");
        if (head) { head.textContent = "Required Documents"; head.className = "vcp-h"; }
        // Submit for Review: locked until every required document is in.
        const btn = panel.querySelector('button[onclick="submitVendorKyc()"]');
        if (btn) {
            btn.className = "vcp-submit";
            btn.removeAttribute("style");
            btn.innerHTML = ico("arrow", 18) + " Submit for Review";
            btn.disabled = s.missing + s.redo > 0;
            let note = document.getElementById("vcp-submit-note");
            if (!note) {
                note = document.createElement("p");
                note.id = "vcp-submit-note";
                note.className = "vcp-submit-note";
                btn.insertAdjacentElement("afterend", note);
            }
            note.innerHTML = btn.disabled ? ico("lock", 15) + " All required documents must be uploaded before review." : "";
        }
    };

    // Home screen
    window.vdComplianceHome = async function (el) {
        if (!el) return;
        let k;
        try { k = await vendorAuthorizedFetch("/api/vendors/me/kyc"); } catch (e) { return; }
        if (!k || k.error) return;
        const s = summary(k);
        const box = document.createElement("div");
        box.className = "vcp-home";
        box.innerHTML = banner(k, s, "home") + (s.verified && vcpDismissed() ? "" : card(s));
        if (!box.innerHTML.trim()) return;
        const header = el.querySelector(".vm-header");
        if (header) header.insertAdjacentElement("afterend", box);
        else el.prepend(box);
    };

    function vcpKey() { return "lzVerifiedBannerClosed"; }
    function vcpDismissed() { try { return localStorage.getItem(vcpKey()) === "1"; } catch (e) { return false; } }
    window.vcpDismiss = function (btn) {
        try { localStorage.setItem(vcpKey(), "1"); } catch (e) { /* fine */ }
        const home = btn.closest(".vcp-home");
        if (home) home.remove();
    };
    window.LzVendorComplianceUi = { summary, banner, card };
})();
