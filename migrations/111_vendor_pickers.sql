-- 111_vendor_pickers.sql
-- Manage Pickers (Jumia Vendor Center comparison, September 2026): a vendor
-- registers the people authorized to physically hand over their packages
-- at a Lizimas drop-off point/hub on their behalf - matching Jumia's
-- Account > Manage Pickers screen. This is a contact registry only: name,
-- phone, and an optional national ID number for the hub desk to check
-- against when someone shows up claiming to be that vendor's picker.
--
-- Deliberately NOT wired into the existing handover pipeline
-- (vendor_fulfilment_stage / handover_status on order_items) - a picker
-- being on file doesn't itself authorize a handover, it's a lookup aid for
-- whoever is staffing the desk. Any tighter enforcement (e.g. requiring a
-- registered picker's ID before accepting a handover) is a deliberately
-- flagged, NOT-built follow-up.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_pickers (
    id              SERIAL PRIMARY KEY,
    vendor_id       INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    full_name       VARCHAR(120) NOT NULL,
    phone           VARCHAR(30) NOT NULL,
    id_number       VARCHAR(50),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_by      INTEGER REFERENCES public.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_pickers_vendor
    ON public.vendor_pickers (vendor_id);

-- Lets the hub desk (admin side) search "who is this person" by name or
-- phone across every vendor's picker list, not just look one vendor up at
-- a time - see adminPickerController.js's searchPickersAdmin.
CREATE INDEX IF NOT EXISTS idx_vendor_pickers_full_name_trgm
    ON public.vendor_pickers USING GIN (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_vendor_pickers_phone
    ON public.vendor_pickers (phone);

COMMENT ON TABLE public.vendor_pickers IS
    'People a vendor has authorized to hand over packages on their behalf at a Lizimas drop-off point/hub - a contact registry for desk verification, not a handover-permission gate.';
COMMENT ON COLUMN public.vendor_pickers.id_number IS
    'Optional national ID / voter card number the picker can present at the hub desk for verification.';

INSERT INTO public.schema_migrations (filename, note)
VALUES ('111_vendor_pickers.sql', 'Manage Pickers: vendor-authorized handover contacts, admin-searchable at the hub desk.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
