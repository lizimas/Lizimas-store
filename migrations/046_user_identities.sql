BEGIN;

CREATE TABLE IF NOT EXISTS public.user_identities (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL
                     REFERENCES public.users(id) ON DELETE CASCADE,
  provider         VARCHAR(20)  NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  provider_email   VARCHAR(255),
  email_verified   BOOLEAN NOT NULL DEFAULT false,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ,
  CONSTRAINT user_identities_provider_check
    CHECK (provider IN ('google','facebook'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_identities_provider_sub
  ON public.user_identities (provider, provider_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_identities_user_provider
  ON public.user_identities (user_id, provider);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
  ON public.user_identities (user_id);

COMMENT ON TABLE public.user_identities IS
  'Federated sign-in links. One row per (user, provider). Customer accounts only; staff/admin never authenticate via OAuth.';

COMMENT ON INDEX public.uq_user_identities_provider_sub IS
  'Anti-takeover: one provider account can never map to two users.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
  '046_user_identities.sql',
  'Google/Facebook sign-in identity links for customer accounts.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
