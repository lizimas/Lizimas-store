-- 082_vendor_jumia_integration.sql
-- Vendor <-> Jumia product linking (Ryan, Sept 2026 - "in future I can
-- link products from Lizimas directly to Jumia, and vendors who are
-- already on Jumia can link their products from Jumia to Lizimas").
--
-- Jumia's own Vendor Center exposes a per-seller OAuth2 "Application"
-- (Settings > Applications: Client ID + Client Secret, the same screen
-- shown in Ryan's reference screenshots) - a vendor creates one there and
-- gives Lizimas the Client ID/Secret so this app can call Jumia's Vendor
-- API on their behalf. That's the credential this migration stores.
--
-- vendor_jumia_connections is one row per vendor: the OAuth credentials
-- (client secret and both tokens encrypted at rest, reusing
-- server/utils/encryption.js - the same AES-256-GCM helper added for
-- vendor_kyc, despite its KYC-scoped env var name; see that file's
-- comment) plus connection status so the UI can show connected/attention
-- needed/disconnected without ever decrypting anything just to render a
-- status pill.
--
-- jumia_product_links is many rows per vendor: one per Lizimas<->Jumia
-- product pairing, independent of direction, so both "push my Lizimas
-- product to Jumia" and "pull my Jumia product into Lizimas" share the
-- same link row and the same sync-status machinery once a pairing
-- exists. product_id is nullable because a pull-import's link can exist
-- for a moment before the Lizimas product row it creates does.
--
-- jumia_sync_log is an append-only audit trail (modelled on
-- vendor_kyc_audit_log) - every push/pull/import/token-refresh attempt,
-- success or failure, so a vendor (or Ryan) can see exactly what
-- happened rather than just the current status.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_jumia_connections (
    id                   SERIAL PRIMARY KEY,
    vendor_id            INTEGER NOT NULL UNIQUE REFERENCES public.vendors(id) ON DELETE CASCADE,
    client_id            TEXT NOT NULL,
    client_secret_enc    TEXT NOT NULL,
    access_token_enc     TEXT,
    refresh_token_enc    TEXT,
    token_expires_at     TIMESTAMPTZ,
    connection_status    VARCHAR(20) NOT NULL DEFAULT 'disconnected'
                             CHECK (connection_status IN (
                                 'disconnected', 'connected', 'error', 'token_expired'
                             )),
    jumia_shop_name      TEXT,
    last_connected_at    TIMESTAMPTZ,
    last_error           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vendor_jumia_connections IS
    'One row per vendor: their Jumia Vendor Center OAuth2 Application credentials (Settings > Applications on Jumia''s side) and current connection/token status. client_secret_enc/access_token_enc/refresh_token_enc are AES-256-GCM encrypted via server/utils/encryption.js - never stored or logged in plaintext. client_id is not treated as secret (Jumia shows it in their own UI) so it is stored as plain text for easy display.';

CREATE TABLE IF NOT EXISTS public.jumia_product_links (
    id                    SERIAL PRIMARY KEY,
    vendor_id             INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    product_id            INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
    jumia_seller_sku      VARCHAR(255) NOT NULL,
    jumia_product_id      VARCHAR(255),
    sync_direction        VARCHAR(10) NOT NULL CHECK (sync_direction IN ('push', 'pull')),
    sync_status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                              CHECK (sync_status IN (
                                  'pending', 'synced', 'failed', 'out_of_sync'
                              )),
    last_synced_at        TIMESTAMPTZ,
    last_synced_product_updated_at TIMESTAMPTZ,
    last_error            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.jumia_product_links IS
    'One row per Lizimas<->Jumia product pairing. sync_direction records how the pairing was created (push = started life as a Lizimas product pushed out; pull = started life as a Jumia product imported in) but both directions can be re-synced later. last_synced_product_updated_at is a copy of products.updated_at as of the last successful push, compared against the live value to flag sync_status=out_of_sync without needing a payload hash.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_jumia_product_links_vendor_sku
    ON public.jumia_product_links (vendor_id, jumia_seller_sku);

CREATE INDEX IF NOT EXISTS idx_jumia_product_links_product
    ON public.jumia_product_links (product_id);

CREATE INDEX IF NOT EXISTS idx_jumia_product_links_vendor_status
    ON public.jumia_product_links (vendor_id, sync_status);

CREATE TABLE IF NOT EXISTS public.jumia_sync_log (
    id               SERIAL PRIMARY KEY,
    vendor_id        INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    product_link_id  INTEGER REFERENCES public.jumia_product_links(id) ON DELETE SET NULL,
    action           VARCHAR(30) NOT NULL,
    status           VARCHAR(10) NOT NULL CHECK (status IN ('success', 'error')),
    detail           TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.jumia_sync_log IS
    'Append-only audit trail of every Jumia integration attempt (connect, token_refresh, push, pull, import), success or failure, with a human-readable detail message. Read by vendors as a sync history and by Ryan/support for debugging failed syncs.';

CREATE INDEX IF NOT EXISTS idx_jumia_sync_log_vendor ON public.jumia_sync_log (vendor_id, created_at DESC);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '082_vendor_jumia_integration.sql',
    'Adds vendor_jumia_connections (per-vendor Jumia OAuth2 Application credentials, encrypted), jumia_product_links (Lizimas<->Jumia product pairings with sync status), and jumia_sync_log (audit trail) for the Lizimas<->Jumia product-linking feature.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
