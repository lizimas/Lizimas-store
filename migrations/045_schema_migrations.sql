BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT
);

COMMENT ON TABLE public.schema_migrations IS
  'One row per migration file applied to this database. Keyed on filename, not number: duplicate numbers exist (024, 038) and 027 is absent.';

COMMIT;
