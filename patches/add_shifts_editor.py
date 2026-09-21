import shutil, datetime, sys

path = "client/admin-support-control-center.partial.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

anchor = '''    // ---- agents ----
    async function loadAgents() {
      const data = await api('/agents');
      document.getElementById('scc-agents-table').innerHTML = data.agents.length
        ? data.agents.map((a) => `
          <tr>
            <td>${a.staff_name || 'Staff #' + a.staff_id}</td>
            <td>${a.department}</td>
            <td>${a.role}</td>
            <td>${a.current_load}/${a.max_concurrent}</td>
            <td><span class="scc-badge ${a.is_available ? 'online' : 'offline'}">${a.is_available ? 'online' : 'offline'}</span></td>
            <td>${a.active ? 'Yes' : 'Suspended'}</td>
            <td><button class="scc-btn ghost" data-toggle-active="${a.id}" data-active="${a.active}">${a.active ? 'Suspend' : 'Reactivate'}</button></td>
          </tr>`).join('')
        : '<tr><td colspan="7" class="scc-empty">No support agents enrolled yet.</td></tr>';

      root.querySelectorAll('[data-toggle-active]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const active = btn.dataset.active !== 'true';
          await api(`/agents/${btn.dataset.toggleActive}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
          loadAgents();
        });
      });
    }
'''

n = content.count(anchor)
if n != 1:
    print(f"ABORT: anchor found {n}x (expected 1). No changes made.")
    sys.exit(1)

replacement = '''    // ---- agents ----
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    async function loadAgents() {
      const data = await api('/agents');
      document.getElementById('scc-agents-table').innerHTML = data.agents.length
        ? data.agents.map((a) => `
          <tr>
            <td>${a.staff_name || 'Staff #' + a.staff_id}</td>
            <td>${a.department}</td>
            <td>${a.role}</td>
            <td>${a.current_load}/${a.max_concurrent}</td>
            <td><span class="scc-badge ${a.is_available ? 'online' : 'offline'}">${a.is_available ? 'online' : 'offline'}</span></td>
            <td>${a.active ? 'Yes' : 'Suspended'}</td>
            <td style="display:flex; gap:6px;">
              <button class="scc-btn ghost" data-toggle-active="${a.id}" data-active="${a.active}">${a.active ? 'Suspend' : 'Reactivate'}</button>
              <button class="scc-btn ghost" data-edit-shifts="${a.id}">Shifts</button>
            </td>
          </tr>`).join('')
        : '<tr><td colspan="7" class="scc-empty">No support agents enrolled yet.</td></tr>';

      root.querySelectorAll('[data-toggle-active]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const active = btn.dataset.active !== 'true';
          await api(`/agents/${btn.dataset.toggleActive}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
          loadAgents();
        });
      });
      root.querySelectorAll('[data-edit-shifts]').forEach((btn) => {
        btn.addEventListener('click', () => openShiftsEditor(btn.dataset.editShifts));
      });
    }

    // No shifts configured for an agent means "always eligible" (see
    // lib/schedule.js) -- this editor is for the opt-in case where you
    // want to actually restrict an agent to specific hours.
    async function openShiftsEditor(agentId) {
      const wrap = document.getElementById('scc-agent-form-wrap');
      wrap.innerHTML = '<p class="scc-empty">Loading shifts\u2026</p>';
      const data = await api(`/agents/${agentId}/shifts`);
      const byDay = {};
      (data.shifts || []).forEach((s) => { byDay[s.day_of_week] = s; });

      wrap.innerHTML = `
        <form class="scc-form" id="scc-shifts-form" style="margin-top:16px; max-width:560px;">
          <h3 style="margin:0;">Working hours</h3>
          <p style="font-size:0.8rem; color:#8892a6; margin:0;">Leave a day unchecked to leave it unrestricted. An agent with no days checked at all is eligible around the clock.</p>
          ${DAY_NAMES.map((name, i) => `
            <div style="display:flex; align-items:center; gap:10px;">
              <label style="display:flex; align-items:center; gap:6px; min-width:90px; margin:0;">
                <input type="checkbox" data-day="${i}" ${byDay[i] ? 'checked' : ''}> ${name}
              </label>
              <input type="time" data-start="${i}" value="${byDay[i] ? byDay[i].start_time.slice(0,5) : '08:00'}" ${byDay[i] ? '' : 'disabled'} style="width:auto;">
              <span>to</span>
              <input type="time" data-end="${i}" value="${byDay[i] ? byDay[i].end_time.slice(0,5) : '17:00'}" ${byDay[i] ? '' : 'disabled'} style="width:auto;">
            </div>`).join('')}
          <div class="scc-error" id="scc-shifts-error"></div>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="scc-btn gold" type="submit">Save shifts</button>
            <button class="scc-btn ghost" type="button" id="scc-shifts-cancel">Cancel</button>
          </div>
        </form>`;

      const form = document.getElementById('scc-shifts-form');
      form.querySelectorAll('[data-day]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const i = cb.dataset.day;
          form.querySelector(`[data-start="${i}"]`).disabled = !cb.checked;
          form.querySelector(`[data-end="${i}"]`).disabled = !cb.checked;
        });
      });
      document.getElementById('scc-shifts-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const shifts = [];
        for (let i = 0; i < 7; i++) {
          const cb = form.querySelector(`[data-day="${i}"]`);
          if (!cb.checked) continue;
          const start = form.querySelector(`[data-start="${i}"]`).value;
          const end = form.querySelector(`[data-end="${i}"]`).value;
          if (!start || !end) {
            document.getElementById('scc-shifts-error').textContent = `${DAY_NAMES[i]} needs both a start and end time.`;
            return;
          }
          shifts.push({ day_of_week: i, start_time: start, end_time: end });
        }
        try {
          await api(`/agents/${agentId}/shifts`, { method: 'PUT', body: JSON.stringify({ shifts }) });
          wrap.innerHTML = '';
        } catch (err) {
          document.getElementById('scc-shifts-error').textContent = err.message;
        }
      });
    }
'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)
content = content.replace(anchor, replacement, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Patched. Backup at " + backup)
