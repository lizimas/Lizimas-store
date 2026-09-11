-- 085_admin_jumia_integration.sql
-- Ryan (Sept 2026): "i wanted same application on vendor to be in admin
-- panel so that i can myself push some products on jumia" - the same
-- Applications concept vendors got in migration 084 (create a named
-- Jumia Application, Self Authorization or Web Application, connect it,
-- push/pull/import products against whichever one is active), but for
-- Lizimas's own store-owned products rather than a vendor's.
--
-- A vendor's Jumia connection is scoped by vendor_id because there are
-- many vendors. There is only one "store", so admin_jumia_connections has
-- no owning-id column at all - every row belongs to the store, exactly
-- one of them is_active at a time. Deliberately a separate table (not a
-- nullable vendor_id on vendor_jumia_connections) so this never risks the
-- vendor Jumia feature already live and in use: no shared constraint, no
-- shared code path, nothing to get subtly wrong for one while touching
-- the other.
--
-- admin_jumia_product_links mirrors jumia_product_links the same way,
-- for pairings between Jumia and Lizimas's own products (products.vendor_id
-- IS NULL) - never a vendor's product, which stays on the vendor path.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_jumia_connections (
    id                   SERIAL PRIMARY KEY,
    name                 TEXT NOT NULL,
    app_type             VARCHAR(20) NOT NULL DEFAULT 'self_authorization'
                             CHECK (app_type IN ('self_authorization', 'web_application')),
    client_id            TEXT NOT NULL DEFAULT '',
    client_secret_enc    TEXT NOT NULL DEFAULT '',
    access_token_enc     TEXT,
    refresh_token_enc    TEXT,
    token_expires_at     TIMESTAMPTZ,
    redirect_uri         TEXT,
    connection_status    VARCHAR(20) NOT NULL DEFAULT 'disconnected'
                             CHECK (connection_status IN (
                                 'disconnected', 'connected', 'error', 'token_expired'
                             )),
    jumia_shop_name      TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT false,
    last_connected_at    TIMESTAMPTZ,
    last_error           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_jumia_connections IS
    'Store-level Jumia Applications - the same concept as vendor_jumia_connections (migration 082/084) but owned by Lizimas itself rather than any one vendor, for pushing/pulling Lizimas''s own products (products.vendor_id IS NULL) to/from Jumia. Exactly one row is_active at a time (uq_admin_jumia_connections_active); that is the one product push/pull/import use.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_jumia_connections_active
    ON public.admin_jumia_connections (is_active)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.admin_jumia_product_links (
    id                              SERIAL PRIMARY KEY,
    product_id                      INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
    jumia_seller_sku                VARCHAR(255) NOT NULL,
    jumia_product_id                VARCHAR(255),
    sync_direction                  VARCHAR(10) NOT NULL CHECK (sync_direction IN ('push', 'pull')),
    sync_status                     VARCHAR(20) NOT NULL DEFAULT 'pending'
                                        CHECK (sync_status IN (
                                            'pending', 'synced', 'failed', 'out_of_sync'
                                        )),
    last_synced_at                  TIMESTAMPTZ,
    last_synced_product_updated_at  TIMESTAMPTZ,
    last_error                      TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_jumia_product_links IS
    'One row per Lizimas<->Jumia product pairing for Lizimas''s own store-owned products (mirrors jumia_product_links, which is vendor-scoped). sync_direction/sync_status/last_synced_product_updated_at all carry the same meaning as the vendor table - see its comment in migration 082.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_jumia_product_links_sku
    ON public.admin_jumia_product_links (jumia_seller_sku);

CREATE INDEX IF NOT EXISTS idx_admin_jumia_product_links_product
    ON public.admin_jumia_product_links (product_id);

CREATE INDEX IF NOT EXISTS idx_admin_jumia_product_links_status
    ON public.admin_jumia_product_links (sync_status);

CREATE TABLE IF NOT EXISTS public.admin_jumia_sync_log (
    id               SERIAL PRIMARY KEY,
    product_link_id  INTEGER REFERENCES public.admin_jumia_product_links(id) ON DELETE SET NULL,
    action           VARCHAR(30) NOT NULL,
    status           VARCHAR(10) NOT NULL CHECK (status IN ('success', 'error')),
    detail           TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_jumia_sync_log IS
    'Append-only audit trail for the store-level Jumia integration, mirroring jumia_sync_log (migration 082) for Lizimas''s own products instead of a vendor''s.';

CREATE INDEX IF NOT EXISTS idx_admin_jumia_sync_log_created ON public.admin_jumia_sync_log (created_at DESC);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '085_admin_jumia_integration.sql',
    'Adds admin_jumia_connections, admin_jumia_product_links, and admin_jumia_sync_log - the same Jumia Applications concept vendors have (migration 084), scoped to the store itself (products.vendor_id IS NULL) so admin can push/pull Lizimas''s own products independently of any vendor''s Jumia connection.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
