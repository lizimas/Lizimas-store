-- 107_vendor_staff_users.sql
-- Vendor Users/Roles (September 2026):
-- lets a vendor invite sub-accounts under their own shop with granular
-- permissions Settings > Users screen (11 "VC - <Role>"
-- checkboxes). A vendor_staff_users row is a one-way link from an existing
-- `users` row (role='vendor_staff', created through the same staff
-- invitation flow used for admin-side staff) to the vendor it belongs to.
--
-- Deliberately does NOT let staff manage other staff or their own roles -
-- only the vendor owner (role='vendor') can create/edit/disable a Users
-- row (see vendorController.js's createVendorStaffUser/updateVendorStaffUser
-- /toggleVendorStaffUserEnabled), so a compromised staff login can never
-- escalate its own access.
--
-- Permission codes (roles TEXT[]) mirror the channel's naming, prefixed vc_ to
-- read cleanly in code: vc_product_manager, vc_product_viewer,
-- vc_product_update, vc_order_viewer, vc_order_manager, vc_order_report,
-- vc_finance_viewer, vc_promotion_manager, vc_shop_viewer, vc_shop_manager,
-- vc_advertising_manager (reserved for the Advertise Your Products build).
-- Enforced in server/utils/vendorContext.js's hasVendorPermission(), not by
-- a DB constraint - the list is expected to grow.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vendor_staff_users (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    vendor_id       INTEGER NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
    roles           TEXT[] NOT NULL DEFAULT '{}',
    enabled         BOOLEAN NOT NULL DEFAULT true,
    invited_by      INTEGER REFERENCES public.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_staff_users_vendor
    ON public.vendor_staff_users (vendor_id);

-- Audit trail, matching the vendor_kyc_audit_log (079) / vendor_payment_
-- instrument_audit_log (103) / prohibited_items_audit_log (106) pattern:
-- action + before/after JSONB snapshots + actor, so "who changed this
-- staff member's roles and when" is always reconstructable.
CREATE TABLE IF NOT EXISTS public.vendor_staff_users_audit_log (
    id                  SERIAL PRIMARY KEY,
    vendor_staff_user_id INTEGER REFERENCES public.vendor_staff_users(id) ON DELETE SET NULL,
    action              VARCHAR(20) NOT NULL
                            CHECK (action IN ('created', 'roles_updated', 'enabled', 'disabled', 'deleted')),
    changed_by          INTEGER REFERENCES public.users(id),
    before_state        JSONB,
    after_state         JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_staff_users_audit_log_staff
    ON public.vendor_staff_users_audit_log (vendor_staff_user_id, created_at DESC);

COMMENT ON TABLE public.vendor_staff_users IS
    'Vendor sub-accounts (Settings > Users). user_id is that staff member''s own users row (role=vendor_staff) - req.user.userId always stays their own true id, never the vendor owner''s; server/utils/vendorContext.js resolves which vendor_id they act on and what vc_* roles they hold. Only the vendor owner can write this table.';
COMMENT ON COLUMN public.vendor_staff_users.roles IS
    'Array of vc_* permission codes (vc_product_manager, vc_product_viewer, vc_product_update, vc_order_viewer, vc_order_manager, vc_order_report, vc_finance_viewer, vc_promotion_manager, vc_shop_viewer, vc_shop_manager, vc_advertising_manager). Checked by hasVendorPermission() in server/utils/vendorContext.js, not a DB constraint.';
COMMENT ON COLUMN public.vendor_staff_users.enabled IS
    'Mirrors Channel''s per-user enable/disable toggle. A disabled row blocks vendorContext resolution entirely (treated as no vendor profile), not just permission checks - a disabled staff login can authenticate but every vendor-scoped endpoint 404s.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '107_vendor_staff_users.sql',
    'Vendor Users/Roles: vendor_staff_users links a users row (role=vendor_staff) to a vendor with an array of vc_* permission codes, plus vendor_staff_users_audit_log. Owner-managed only - staff cannot edit vendor_staff_users themselves.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
