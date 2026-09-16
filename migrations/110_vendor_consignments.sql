-- 110_vendor_consignments.sql
-- Fulfillment-by-Lizimas (Jumia Vendor Center comparison, September 2026 -
-- Jumia calls this "Fulfillment by Jumia"/FBJ: a seller ships stock to a
-- Jumia warehouse and Jumia picks/packs/delivers orders directly, instead
-- of the seller handing over each order one at a time). Lizimas has no
-- warehouse network, so this reuses the existing dropoff_points hub
-- concept (migrations/052_vendor_fulfilment.sql) as the anchor: a vendor
-- consigns stock to one of Lizimas' own hub locations, admin receives and
-- counts it in, and that quantity becomes consigned_stock Lizimas holds
-- on the vendor's behalf.
--
-- Deliberately schema + vendor-request-flow ONLY in this migration/pass -
-- routing a placed ORDER to fulfill straight from consigned_stock (skipping
-- the vendor per-order handover step in vendor_fulfilment_stage/
-- handover_status) is real checkout/fulfillment-pipeline surgery and is
-- left as a clearly-flagged follow-up, same spirit as the "known gaps left
-- for Ryan on purpose" pattern elsewhere in PENDING.md - consigned_stock
-- exists and is counted in here, but nothing in checkoutController.js
-- reads it yet.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_consignments (
    id                  SERIAL PRIMARY KEY,
    vendor_id           INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    dropoff_point_id    INTEGER NOT NULL REFERENCES public.dropoff_points(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'requested'
                            CHECK (status IN ('requested', 'in_transit', 'received', 'partially_received', 'rejected', 'cancelled')),
    vendor_notes        TEXT,
    admin_notes         TEXT,
    reviewed_by         INTEGER REFERENCES public.users(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_consignments_vendor ON public.vendor_consignments (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_consignments_status ON public.vendor_consignments (status) WHERE status IN ('requested', 'in_transit');

CREATE TABLE IF NOT EXISTS public.vendor_consignment_items (
    id                  SERIAL PRIMARY KEY,
    consignment_id      INTEGER NOT NULL REFERENCES public.vendor_consignments(id) ON DELETE CASCADE,
    product_id          INTEGER NOT NULL REFERENCES public.products(id),
    quantity_requested  INTEGER NOT NULL CHECK (quantity_requested > 0),
    quantity_received   INTEGER CHECK (quantity_received IS NULL OR quantity_received >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_consignment_items_consignment ON public.vendor_consignment_items (consignment_id);
CREATE INDEX IF NOT EXISTS idx_vendor_consignment_items_product ON public.vendor_consignment_items (product_id);

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS fulfillment_type VARCHAR(20) NOT NULL DEFAULT 'vendor_fulfilled'
        CHECK (fulfillment_type IN ('vendor_fulfilled', 'lizimas_fulfilled')),
    ADD COLUMN IF NOT EXISTS consigned_stock INTEGER NOT NULL DEFAULT 0 CHECK (consigned_stock >= 0);

COMMENT ON TABLE public.vendor_consignments IS
    'A shipment of stock a vendor sends to a Lizimas hub for Lizimas to fulfill orders from directly (Fulfillment-by-Lizimas, Jumia FBJ comparison). See vendor_consignment_items for the line items and products.consigned_stock for the counted-in result.';
COMMENT ON COLUMN public.vendor_consignments.status IS
    'requested (vendor submitted, nothing shipped yet) -> in_transit (vendor marked it shipped) -> received/partially_received (admin counted it in - see vendor_consignment_items.quantity_received) or rejected. cancelled only from requested/in_transit, by the vendor.';
COMMENT ON COLUMN public.products.fulfillment_type IS
    'vendor_fulfilled (default): the vendor hands over each order themselves, as today. lizimas_fulfilled: this listing has consigned_stock at a Lizimas hub. Set automatically the first time a consignment for this product is received - see vendorConsignmentController.js.';
COMMENT ON COLUMN public.products.consigned_stock IS
    'Units of this product Lizimas is physically holding on the vendor''s behalf, counted in from received vendor_consignment_items. NOT yet read anywhere in the order/checkout pipeline - see this migration''s header.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '110_vendor_consignments.sql',
    'Fulfillment-by-Lizimas: vendor_consignments/vendor_consignment_items (vendor ships stock to a Lizimas hub, admin counts it in) + products.fulfillment_type/consigned_stock. Schema + vendor request flow only - order-routing integration is a deliberate follow-up, not built here.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
