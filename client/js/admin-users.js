// Admin > Users & Permissions (migration 133, Ryan Sept 2026).
// The store owner adds team members with their own admin login and ticks
// which admin sections each may use - the admin twin of the Vendor Center's
// Manage Users. Server: server/controllers/adminUsersController.js.
(function () {
    "use strict";
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    let users = [];
    let roles = [];
    let editing = null; // null = create, else user object
    let query = "";

    async function api(path, opts = {}) {
        const token = typeof getToken === "function" ? getToken() : localStorage.getItem("adminToken");
        const res = await fetch(path, { ...opts, cache: "no-store",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
        let body = null;
        try { body = await res.json(); } catch (e) { /* empty */ }
        if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
        return body;
    }
    const toast = (m) => (typeof showToast === "function" ? showToast(m) : console.log(m));
    const fmt = (d) => d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never";
    const label = (code) => (roles.find((r) => r.code === code) || { label: code }).label;

    async function load() {
        $("aux-list").innerHTML = `<tr><td colspan="6" class="aux-muted">Loading&hellip;</td></tr>`;
        try {
            const r = await api("/api/admin/admin-users");
            users = r.users; roles = r.roles;
            render();
        } catch (e) {
            $("aux-list").innerHTML = `<tr><td colspan="6" class="aux-err">${esc(e.message)}</td></tr>`;
        }
    }

    function render() {
        const q = query.toLowerCase();
        const rows = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
        $("aux-count").textContent = `(${users.length})`;
        if (!rows.length) {
            $("aux-list").innerHTML = `<tr><td colspan="6" class="aux-muted">${users.length ? "No users match." : "No team members yet &mdash; press <b>+ Create User</b>."}</td></tr>`;
            return;
        }
        $("aux-list").innerHTML = rows.map((u) => {
            const status = !u.enabled ? `<span class="aux-st aux-st-off">Disabled</span>`
                : u.pending_setup ? `<span class="aux-st aux-st-wait">Invite sent</span>`
                : `<span class="aux-st aux-st-on">Active</span>`;
            return `<tr>
                <td data-label="Name"><b>${esc(u.name)}</b></td>
                <td data-label="Email">${esc(u.email)}</td>
                <td data-label="Permissions"><div class="aux-chips">${u.permissions.map((c) => `<span class="aux-chip">${esc(label(c))}</span>`).join("") || '<span class="aux-muted">None</span>'}</div></td>
                <td data-label="Status">${status}</td>
                <td data-label="Last sign-in"><small>${esc(fmt(u.last_login_at))}</small></td>
                <td><button type="button" class="aux-link" data-edit="${u.id}">Assign Permissions</button></td>
            </tr>`;
        }).join("");
    }

    function renderPerms(selected) {
        const set = new Set(selected || []);
        $("aux-perms").innerHTML = roles.map((r) => `
            <label class="aux-perm">
                <input type="checkbox" value="${esc(r.code)}" ${set.has(r.code) ? "checked" : ""}>
                <span><b>${esc(r.label)}</b><small>${esc(r.description)}</small></span>
            </label>`).join("");
    }

    function openEditor(user) {
        editing = user || null;
        $("aux-editor").hidden = false;
        $("aux-error").textContent = "";
        $("aux-editor-title").textContent = user ? `Assign Permissions: ${user.name}` : "Create User";
        $("aux-name").value = user ? user.name : "";
        $("aux-email").value = user ? user.email : "";
        $("aux-email").disabled = !!user;
        $("aux-save").textContent = user ? "Save Permissions" : "Send Invite";
        $("aux-resend").hidden = !user;
        $("aux-toggle").hidden = !user;
        $("aux-delete").hidden = !user;
        if (user) $("aux-toggle").textContent = user.enabled ? "Disable" : "Enable";
        renderPerms(user ? user.permissions : []);
        $("aux-editor").scrollIntoView({ behavior: "smooth", block: "start" });
        (user ? $("aux-name") : $("aux-name")).focus({ preventScroll: true });
    }
    function closeEditor() { $("aux-editor").hidden = true; editing = null; }
    const picked = () => [...document.querySelectorAll("#aux-perms input:checked")].map((b) => b.value);

    async function save() {
        const name = $("aux-name").value.trim();
        const email = $("aux-email").value.trim();
        const permissions = picked();
        if (!name) return ($("aux-error").textContent = "Enter the person's name.");
        if (!editing && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ($("aux-error").textContent = "Enter a valid email address.");
        if (!permissions.length) return ($("aux-error").textContent = "Tick at least one permission.");
        $("aux-save").disabled = true;
        try {
            const r = editing
                ? await api(`/api/admin/admin-users/${editing.id}`, { method: "PUT", body: JSON.stringify({ name, permissions }) })
                : await api("/api/admin/admin-users", { method: "POST", body: JSON.stringify({ name, email, permissions }) });
            toast(r.message || "Saved");
            closeEditor();
            load();
        } catch (e) {
            $("aux-error").textContent = e.message;
        } finally {
            $("aux-save").disabled = false;
        }
    }

    async function act(fn) {
        try { const r = await fn(); toast(r.message || "Done"); closeEditor(); load(); }
        catch (e) { $("aux-error").textContent = e.message; }
    }

    let wired = false;
    function init() {
        if (!$("tab-admin-users")) return;
        if (!wired) {
            wired = true;
            $("aux-create-btn").addEventListener("click", () => openEditor(null));
            $("aux-cancel").addEventListener("click", closeEditor);
            $("aux-save").addEventListener("click", save);
            $("aux-all").addEventListener("click", () => document.querySelectorAll("#aux-perms input").forEach((b) => { b.checked = true; }));
            $("aux-none").addEventListener("click", () => document.querySelectorAll("#aux-perms input").forEach((b) => { b.checked = false; }));
            $("aux-search").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });
            $("aux-list").addEventListener("click", (e) => {
                const b = e.target.closest("[data-edit]");
                if (b) openEditor(users.find((u) => u.id === Number(b.dataset.edit)));
            });
            $("aux-resend").addEventListener("click", () => editing && act(() => api(`/api/admin/admin-users/${editing.id}/resend-invite`, { method: "POST" })));
            $("aux-toggle").addEventListener("click", () => {
                if (!editing) return;
                const enable = !editing.enabled;
                if (!enable && !confirm(`Disable ${editing.name}? They are signed out everywhere straight away.`)) return;
                act(() => api(`/api/admin/admin-users/${editing.id}/enabled`, { method: "PATCH", body: JSON.stringify({ enabled: enable }) }));
            });
            $("aux-delete").addEventListener("click", () => {
                if (!editing || !confirm(`Remove ${editing.name}? Their admin login stops working straight away.`)) return;
                act(() => api(`/api/admin/admin-users/${editing.id}`, { method: "DELETE" }));
            });
        }
        closeEditor();
        load();
    }
    document.addEventListener("click", (e) => {
        if (e.target.closest('.tab-btn[data-tab="admin-users"]')) setTimeout(init, 0);
    });
    window.LzAdminUsers = { init };
})();
