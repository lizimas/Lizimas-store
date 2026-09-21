-- 120_support_control_center.sql
-- Support Control Center: admin tooling for managing the live-support team.
--
-- Built AGAINST your real schema (from migrations 012-015), not next to it:
--   - staff are rows in `users`, so support_agents.staff_id references users(id)
--   - live capacity/online-status already lives in `staff_availability`
--     (is_available, max_concurrent, last_heartbeat) -- this migration does
--     NOT duplicate that. support_agents only adds what staff_availability
--     doesn't have: role, department, skills, and whether someone is
--     enrolled in support duty at all.
--   - chat_conversations has no department/category column yet, so
--     support_queue_rules / support_sla_policies are seeded with a single
--     'general' row and only that row is consulted by the live-monitor and
--     performance queries for now. The per-department admin UI is there for
--     when you add a category column -- it just doesn't split live data yet.
--   - "current load" is computed on the fly as a COUNT of chat_conversations
--     where assigned_staff_id = the agent and status IN ('open','pending') --
--     it's not stored anywhere, so there's nothing to keep in sync.

BEGIN;

CREATE TABLE IF NOT EXISTS support_agents (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'agent'
    CHECK (role IN ('agent', 'supervisor')),
  department VARCHAR(50) NOT NULL DEFAULT 'general', -- reserved; see note above
  skills TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true, -- enrolled in support duty; suspend = false
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_shifts (
  id SERIAL PRIMARY KEY,
  agent_id INTEGER NOT NULL REFERENCES support_agents(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_shifts_agent ON support_shifts(agent_id);

CREATE TABLE IF NOT EXISTS support_queue_rules (
  id SERIAL PRIMARY KEY,
  department VARCHAR(50) NOT NULL UNIQUE DEFAULT 'general',
  routing_mode VARCHAR(20) NOT NULL DEFAULT 'least_busy'
    CHECK (routing_mode IN ('round_robin', 'least_busy', 'skill_based')),
  max_queue_wait_seconds INTEGER NOT NULL DEFAULT 120 CHECK (max_queue_wait_seconds > 0),
  overflow_action VARCHAR(20) NOT NULL DEFAULT 'keep_queued'
    CHECK (overflow_action IN ('keep_queued', 'escalate', 'offline_message')),
  business_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  business_hours_start TIME DEFAULT '08:00',
  business_hours_end TIME DEFAULT '20:00',
  offline_message TEXT NOT NULL DEFAULT
    'Our support team is currently offline. Please leave a message and we will get back to you.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO support_queue_rules (department) VALUES ('general')
  ON CONFLICT (department) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_canned_responses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(60) NOT NULL DEFAULT 'general',
  created_by INTEGER, -- support_agents.id of the author, nullable
  shared BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_canned_category ON support_canned_responses(category) WHERE active = true;

CREATE TABLE IF NOT EXISTS support_sla_policies (
  id SERIAL PRIMARY KEY,
  department VARCHAR(50) NOT NULL UNIQUE DEFAULT 'general',
  first_response_target_seconds INTEGER NOT NULL DEFAULT 60 CHECK (first_response_target_seconds > 0),
  resolution_target_seconds INTEGER NOT NULL DEFAULT 1800 CHECK (resolution_target_seconds > 0),
  breach_alert_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO support_sla_policies (department) VALUES ('general')
  ON CONFLICT (department) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_audit_log (
  id SERIAL PRIMARY KEY,
  actor_staff_id INTEGER, -- references users(id), no FK so a deleted admin doesn't break old log rows
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(40),
  target_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_audit_created ON support_audit_log(created_at DESC);

INSERT INTO schema_migrations (filename, note) VALUES
  ('120_support_control_center.sql', 'Support Control Center: agent roster/roles on top of staff_availability, queue rules, canned responses, SLA policies, audit log');

COMMIT;
