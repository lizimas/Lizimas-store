import sys, shutil, datetime

path = "client/admin-support-control-center.partial.html"
with open(path, encoding="utf-8") as f:
    content = f.read()

marker_agents = "    // ---- agents ----"
marker_queue = "    // ---- queue rules ----"
marker_canned = "    // ---- canned responses ----"

for m in (marker_agents, marker_queue, marker_canned):
    n = content.count(m)
    if n != 1:
        print(f"ABORT: marker {m!r} found {n}x (expected 1). No changes made.")
        sys.exit(1)

i_agents = content.index(marker_agents)
i_queue = content.index(marker_queue)
i_canned = content.index(marker_canned)
if not (i_agents < i_queue < i_canned):
    print("ABORT: markers are not in the expected order. No changes made.")
    sys.exit(1)

new_agents = '''    // ---- agents ----
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const DEPARTMENTS = [
      { key: 'orders_payments', label: '\U0001F6D2 Orders & Payments' },
      { key: 'delivery', label: '\U0001F69A Delivery' },
      { key: 'product_info', label: '\U0001F4E6 Product Information' },
      { key: 'returns_refunds', label: '\u21A9\uFE0F Returns & Refunds' },
      { key: 'account_login', label: '\U0001F510 Account & Login' },
      { key: 'technical', label: '\U0001F6E0\uFE0F Technical Support' },
      { key: 'general', label: '\U0001F4AC General Question' },
    ];

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
              <button class="scc-btn ghost" data-edit-agent="${a.id}">Edit</button>
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
      root.querySelectorAll('[data-edit-agent]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const a = data.agents.find((x) => String(x.id) === btn.dataset.editAgent);
          if (a) openAgentForm(a);
        });
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

    // Shared by "+ Add support agent" (existing = null) and "Edit"
    // (existing = the full row). staff_id is create-only -- the backend
    // never accepts changing who an agent row refers to, only their
    // role/department/skills, so it's shown read-only when editing.
    function openAgentForm(existing) {
      const wrap = document.getElementById('scc-agent-form-wrap');
      const skillSet = new Set((existing && existing.skills) || []);
      wrap.innerHTML = `
        <form class="scc-form" id="scc-agent-form" style="margin-top:16px;">
          <h3 style="margin:0;">${existing ? 'Edit ' + (existing.staff_name || 'agent') : 'Add support agent'}</h3>
          ${existing
            ? `<div><label>Staff ID</label><input value="${existing.staff_id}" disabled></div>`
            : `<div><label>Staff ID</label><input name="staff_id" type="number" required></div>`}
          <div><label>Home department</label>
            <select name="department">
              ${DEPARTMENTS.map((d) => `<option value="${d.key}" ${existing && existing.department === d.key ? 'selected' : ''}>${d.label}</option>`).join('')}
            </select>
          </div>
          <div><label>Role</label>
            <select name="role">
              <option value="agent" ${existing && existing.role === 'agent' ? 'selected' : ''}>Agent</option>
              <option value="senior_agent" ${existing && existing.role === 'senior_agent' ? 'selected' : ''}>Senior Agent</option>
              <option value="supervisor" ${existing && existing.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
            </select>
          </div>
          <div>
            <label>Also route them chats from</label>
            <p style="font-size:0.8rem; color:#8892a6; margin:2px 0 6px;">Beyond their home department above -- e.g. a General agent who also covers Orders &amp; Payments.</p>
            ${DEPARTMENTS.map((d) => `
              <label style="display:inline-flex; align-items:center; gap:4px; margin:0 12px 6px 0; font-weight:400;">
                <input type="checkbox" name="skills" value="${d.key}" ${skillSet.has(d.key) ? 'checked' : ''}> ${d.label}
              </label>`).join('')}
          </div>
          <p style="font-size:0.8rem; color:#8892a6; margin:0;">Max concurrent chats is set by the agent's own chat client, not here \u2014 this just enrolls them for support-panel routing.</p>
          <div class="scc-error" id="scc-agent-error"></div>
          <div style="display:flex; gap:8px;">
            <button class="scc-btn gold" type="submit">${existing ? 'Save changes' : 'Save agent'}</button>
            <button class="scc-btn ghost" type="button" id="scc-agent-cancel">Cancel</button>
          </div>
        </form>`;
      document.getElementById('scc-agent-cancel').addEventListener('click', () => {
        wrap.innerHTML = '';
      });
      document.getElementById('scc-agent-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const skills = f.getAll('skills');
        try {
          if (existing) {
            await api(`/agents/${existing.id}`, { method: 'PATCH', body: JSON.stringify({
              department: f.get('department'),
              role: f.get('role'),
              skills,
            }) });
          } else {
            await api('/agents', { method: 'POST', body: JSON.stringify({
              staff_id: Number(f.get('staff_id')),
              department: f.get('department'),
              role: f.get('role'),
              skills,
            }) });
          }
          wrap.innerHTML = '';
          loadAgents();
        } catch (err) {
          document.getElementById('scc-agent-error').textContent = err.message;
        }
      });
    }

    document.getElementById('scc-add-agent-btn').addEventListener('click', () => openAgentForm(null));

'''

new_queue = '''    // ---- queue rules ----
    async function loadQueueRules() {
      const data = await api('/queue-rules');
      document.getElementById('scc-queue-rules').innerHTML = data.rules.map((r) => `
        <form class="scc-form scc-rule-form" data-dept="${r.department}" style="border-bottom:1px solid var(--ls-border); padding-bottom:16px; margin-bottom:16px;">
          <h3 style="margin:0 0 6px;">${r.department}</h3>
          <div><label>Routing mode</label>
            <select name="routing_mode">
              ${['round_robin','least_busy','skill_based'].map((m) => `<option value="${m}" ${r.routing_mode===m?'selected':''}>${m.replace('_',' ')}</option>`).join('')}
            </select>
          </div>
          <div><label>Max queue wait (seconds)</label><input name="max_queue_wait_seconds" type="number" value="${r.max_queue_wait_seconds}"></div>
          <div><label>Overflow action</label>
            <select name="overflow_action">
              ${['keep_queued','escalate','offline_message'].map((m) => `<option value="${m}" ${r.overflow_action===m?'selected':''}>${m.replace('_',' ')}</option>`).join('')}
            </select>
          </div>
          <div><label>Offline message</label><textarea name="offline_message" rows="2">${esc(r.offline_message)}</textarea></div>
          <div>
            <label><input type="checkbox" class="scc-bh-toggle" name="business_hours_enabled" ${r.business_hours_enabled?'checked':''}> Restrict to business hours</label>
            <div style="display:flex; align-items:center; gap:8px; margin-top:6px;">
              <input type="time" name="business_hours_start" value="${(r.business_hours_start || '08:00:00').slice(0,5)}" ${r.business_hours_enabled ? '' : 'disabled'} style="width:auto;">
              <span>to</span>
              <input type="time" name="business_hours_end" value="${(r.business_hours_end || '20:00:00').slice(0,5)}" ${r.business_hours_enabled ? '' : 'disabled'} style="width:auto;">
            </div>
          </div>
          <button class="scc-btn" type="submit">Save ${r.department} rules</button>
        </form>`).join('');

      root.querySelectorAll('.scc-rule-form').forEach((form) => {
        const toggle = form.querySelector('.scc-bh-toggle');
        toggle.addEventListener('change', () => {
          form.querySelector('[name="business_hours_start"]').disabled = !toggle.checked;
          form.querySelector('[name="business_hours_end"]').disabled = !toggle.checked;
        });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = new FormData(form);
          await api(`/queue-rules/${form.dataset.dept}`, { method: 'PUT', body: JSON.stringify({
            routing_mode: f.get('routing_mode'),
            max_queue_wait_seconds: Number(f.get('max_queue_wait_seconds')),
            overflow_action: f.get('overflow_action'),
            offline_message: f.get('offline_message'),
            business_hours_enabled: f.get('business_hours_enabled') === 'on',
            business_hours_start: f.get('business_hours_start'),
            business_hours_end: f.get('business_hours_end'),
          }) });
          loadQueueRules();
        });
      });
    }

'''

backup = path + ".bak." + datetime.datetime.now().strftime("%Y%m%d%H%M%S")
shutil.copy(path, backup)

new_content = content[:i_agents] + new_agents + new_queue + content[i_canned:]
with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)
print("Patched agents + queue-rules sections. Backup at " + backup)
