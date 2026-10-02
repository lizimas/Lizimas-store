-- 152_vendor_orders_panel.sql
-- Vendor Orders panel (Oct 2026): remember when a label was printed for an
-- order item, and keep the vendor's order exports for the History tab.

BEGIN;

ALTER TABLE public.order_items
    ADD COLUMN IF NOT EXISTS label_printed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.vendor_order_exports (
    id         BIGSERIAL PRIMARY KEY,
    vendor_id  INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    file_name  TEXT NOT NULL,
    row_count  INTEGER NOT NULL DEFAULT 0,
    csv        TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_order_exports_vendor ON public.vendor_order_exports (vendor_id, created_at DESC);

INSERT INTO public.schema_migrations (filename, note)
VALUES ('152_vendor_orders_panel.sql', 'order_items.label_printed_at; vendor_order_exports (export history).')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
