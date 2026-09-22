import shutil, datetime, sys

path = "client/admin-support-control-center.partial.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchors = []

# 1. Table header + empty-state colspan: add a Body column.
anchors.append((
'''  <div class="scc-panel" data-panel="canned">
    <button class="scc-btn gold" id="scc-add-canned-btn" style="margin-bottom:14px;">+ New canned response</button>
    <table>
      <thead><tr><th>Title</th><th>Category</th><th>Shared</th><th></th></tr></thead>
      <tbody id="scc-canned-table"><tr><td colspan="4" class="scc-empty">Loading\u2026</td></tr></tbody>
    </table>
    <div id="scc-canned-form-wrap"></div>
  </div>''',
'''  <div class="scc-panel" data-panel="canned">
    <button class="scc-btn gold" id="scc-add-canned-btn" style="margin-bottom:14px;">+ New canned response</button>
    <table>
      <thead><tr><th>Title</th><th>Body</th><th>Category</th><th>Shared</th><th></th></tr></thead>
      <tbody id="scc-canned-table"><tr><td colspan="5" class="scc-empty">Loading\u2026</td></tr></tbody>
    </table>
    <div id="scc-canned-form-wrap"></div>
  </div>'''
))

# 2. esc() helper, right after timeAgo().
anchors.append((
'''    function timeAgo(iso) {
      const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      return fmtSeconds(diff) + ' ago';
    }

    // ---- tabs ----''',
'''    function timeAgo(iso) {
      const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
      return fmtSeconds(diff) + ' ago';
    }
    // Free text admins type in (canned response titles/bodies) goes through
    // this before landing in innerHTML -- otherwise a stray < or & breaks
    // the row or, worse, lets typed text act as markup.
    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s == null ? '' : String(s);
      return d.innerHTML;
    }

    // ---- tabs ----'''
))

# 3. loadCanned + the add-form, replaced with loadCanned (now showing body,
#    with Edit buttons) + a shared openCannedForm() used by both Add and Edit.
anchors.append((
'''    async function loadCanned() {
      const data = await api('/canned-responses');
      document.getElementById('scc-canned-table').innerHTML = data.cannedResponses.length
        ? data.cannedResponses.map((c) => `
          <tr><td>${c.title}</td><td>${c.category}</td><td>${c.shared ? 'Team' : 'Personal'}</td>
          <td><button class="scc-btn ghost" data-delete-canned="${c.id}">Delete</button></td></tr>`).join('')
        : '<tr><td colspan="4" class="scc-empty">No canned responses yet.</td></tr>';

      root.querySelectorAll('[data-delete-canned]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this canned response?')) return;
          await api(`/canned-responses/${btn.dataset.deleteCanned}`, { method: 'DELETE' });
          loadCanned();
        });
      });
    }

    document.getElementById('scc-add-canned-btn').addEventListener('click', () => {
      const wrap = document.getElementById('scc-canned-form-wrap');
      wrap.innerHTML = `
        <form class="scc-form" id="scc-canned-form" style="margin-top:16px;">
          <div><label>Title</label><input name="title" required maxlength="120"></div>
          <div><label>Category</label><input name="category" value="general"></div>
          <div><label>Body</label><textarea name="body" rows="4" required></textarea></div>
          <div class="scc-error" id="scc-canned-error"></div>
          <button class="scc-btn gold" type="submit">Save response</button>
        </form>`;
      document.getElementById('scc-canned-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await api('/canned-responses', { method: 'POST', body: JSON.stringify({
            title: f.get('title'), category: f.get('category'), body: f.get('body'),
          }) });
          wrap.innerHTML = '';
          loadCanned();
        } catch (err) {
          document.getElementById('scc-canned-error').textContent = err.message;
        }
      });
    });

    // ---- SLA policies ----''',
'''    async function loadCanned() {
      const data = await api('/canned-responses');
      document.getElementById('scc-canned-table').innerHTML = data.cannedResponses.length
        ? data.cannedResponses.map((c) => `
          <tr>
            <td>${esc(c.title)}</td>
            <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(c.body)}">${esc(c.body)}</td>
            <td>${esc(c.category)}</td>
            <td>${c.shared ? 'Team' : 'Personal'}</td>
            <td style="display:flex; gap:6px;">
              <button class="scc-btn ghost" data-edit-canned="${c.id}">Edit</button>
              <button class="scc-btn ghost" data-delete-canned="${c.id}">Delete</button>
            </td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="scc-empty">No canned responses yet.</td></tr>';

      root.querySelectorAll('[data-delete-canned]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this canned response?')) return;
          await api(`/canned-responses/${btn.dataset.deleteCanned}`, { method: 'DELETE' });
          loadCanned();
        });
      });
      root.querySelectorAll('[data-edit-canned]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const c = data.cannedResponses.find((x) => String(x.id) === btn.dataset.editCanned);
          if (c) openCannedForm(c);
        });
      });
    }

    // Shared by "+ New canned response" (existing = null) and "Edit"
    // (existing = the full row) -- same form either way, POST vs PATCH.
    function openCannedForm(existing) {
      const wrap = document.getElementById('scc-canned-form-wrap');
      wrap.innerHTML = `
        <form class="scc-form" id="scc-canned-form" style="margin-top:16px;">
          <h3 style="margin:0;">${existing ? 'Edit response' : 'New response'}</h3>
          <div><label>Title</label><input name="title" required maxlength="120" value="${existing ? esc(existing.title) : ''}"></div>
          <div><label>Category</label><input name="category" value="${existing ? esc(existing.category) : 'general'}"></div>
          <div><label>Body</label><textarea name="body" rows="4" required>${existing ? esc(existing.body) : ''}</textarea></div>
          <div class="scc-error" id="scc-canned-error"></div>
          <div style="display:flex; gap:8px;">
            <button class="scc-btn gold" type="submit">${existing ? 'Save changes' : 'Save response'}</button>
            <button class="scc-btn ghost" type="button" id="scc-canned-cancel">Cancel</button>
          </div>
        </form>`;
      document.getElementById('scc-canned-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
      document.getElementById('scc-canned-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const payload = { title: f.get('title'), category: f.get('category'), body: f.get('body') };
        try {
          if (existing) {
            await api(`/canned-responses/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
          } else {
            await api('/canned-responses', { method: 'POST', body: JSON.stringify(payload) });
          }
          wrap.innerHTML = '';
          loadCanned();
        } catch (err) {
          document.getElementById('scc-canned-error').textContent = err.message;
        }
      });
    }

    document.getElementById('scc-add-canned-btn').addEventListener('click', () => openCannedForm(null));

    // ---- SLA policies ----'''
))

problems = []
for i, (old, new) in enumerate(anchors, 1):
    n = content.count(old)
    if n != 1:
        problems.append(f"  anchor {i}: found {n}x (expected 1)")

if problems:
    print("ABORT: one or more anchors did not match exactly once. No changes made.")
    print("\n".join(problems))
    sys.exit(1)

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
for old, new in anchors:
    content = content.replace(old, new, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print(f"Patched all {len(anchors)} anchors. Backup at " + backup)
