-- 121_support_routing_phase1.sql
-- Support Control Center Phase 1: department-based routing foundation.
--
-- Adds the columns chat_conversations needs to actually be routed on
-- (nothing existed before this — department/priority/assignment_mode/
-- escalation_level are all new). Existing conversations get
-- department = NULL (uncategorized, falls back to manual handling),
-- priority = 'normal', assignment_mode = NULL, escalation_level = 0 —
-- nothing about in-flight or historical conversations changes behavior.
--
-- Also widens support_agents.role to add 'senior_agent' as a middle tier
-- between agent and supervisor, and seeds support_queue_rules /
-- support_sla_policies for all 7 departments (previously only 'general'
-- existed from migration 120).
--
-- The 7 department keys here MUST match server/lib/departments.js exactly.

BEGIN;

-- 1. chat_conversations: routing columns -----------------------------------

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS department VARCHAR(30)
        CHECK (department IS NULL OR department IN (
            'orders_payments', 'delivery', 'product_info', 'returns_refunds',
            'account_login', 'technical', 'general'
        )),
    ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('critical', 'high', 'normal', 'low')),
    ADD COLUMN IF NOT EXISTS assignment_mode VARCHAR(10)
        CHECK (assignment_mode IS NULL OR assignment_mode IN ('auto', 'self', 'manual')),
    ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0
        CHECK (escalation_level >= 0);

CREATE INDEX IF NOT EXISTS idx_chat_conv_dept_status ON chat_conversations (department, status);

-- 2. support_agents: add senior_agent as a role tier ------------------------
-- Dropped and re-added by definition-match, same safe technique as your
-- own 015_chat_escalation.sql, since the auto-generated constraint name
-- from migration 120 was never confirmed.

DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'support_agents'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE support_agents DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE support_agents
    ADD CONSTRAINT support_agents_role_check
    CHECK (role IN ('agent', 'senior_agent', 'supervisor'));

-- support_agents.department also gets a real CHECK now (migration 120 left
-- it as free-text VARCHAR). Safe as-is only because no agents have been
-- enrolled yet (Ryan's own confirmation) -- if this ever fails, it means a
-- department value outside the 7 keys already exists, and needs fixing
-- before this constraint can be added.
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'support_agents'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%department%'
    LOOP
        EXECUTE format('ALTER TABLE support_agents DROP CONSTRAINT %I', c.conname);
    END LOOP;
END $$;

ALTER TABLE support_agents
    ADD CONSTRAINT support_agents_department_check
    CHECK (department IN (
        'orders_payments', 'delivery', 'product_info', 'returns_refunds',
        'account_login', 'technical', 'general'
    ));

-- 3. Seed queue rules + SLA policies for every department -------------------

INSERT INTO support_queue_rules (department) VALUES
    ('orders_payments'), ('delivery'), ('product_info'),
    ('returns_refunds'), ('account_login'), ('technical')
ON CONFLICT (department) DO NOTHING;

INSERT INTO support_sla_policies (department) VALUES
    ('orders_payments'), ('delivery'), ('product_info'),
    ('returns_refunds'), ('account_login'), ('technical')
ON CONFLICT (department) DO NOTHING;

INSERT INTO schema_migrations (filename, note) VALUES
  ('121_support_routing_phase1.sql', 'Phase 1 routing foundation: chat_conversations department/priority/assignment_mode/escalation_level, senior_agent role tier, per-department queue rules and SLA policies');

COMMIT;
