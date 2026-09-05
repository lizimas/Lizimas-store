-- 051_vendor_policy_acceptance.sql
-- Records that a vendor accepted the Lizimas Store vendor policies
-- (Anti-Counterfeit, Content & Image, Packaging, Delivery, Fulfilment,
-- Vendor Data Protection) at registration. Nullable/additive.

ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS policies_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS policies_version VARCHAR(20);

INSERT INTO schema_migrations (filename, note)
VALUES (
    '051_vendor_policy_acceptance.sql',
    'vendors.policies_accepted_at / policies_version - records acceptance of the vendor policy set at registration.'
)
ON CONFLICT (filename) DO NOTHING;
