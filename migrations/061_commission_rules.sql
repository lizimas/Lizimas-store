-- 061_commission_rules.sql
-- The commission engine's data object (spec: "Vendor Center — Complete
-- Developer Specification", section 5). Versioned by design: a rate is
-- never edited in place - closing out the active row and inserting a new
-- one is what "versioned" means here, so an order that copied a rate at
-- the time it was placed keeps that rate even after the rule changes
-- (section 33, "commission locking" - not wired into orders yet, this
-- migration only lays the table down).
--
-- category_id is nullable on purpose: NULL is the marketplace-wide default
-- rule, used when a product's own category (or none of its ancestors) has
-- a specific rate set. This lets the engine work correctly on day one
-- without requiring every one of Lizimas' ~200 categories to have an
-- explicit row - see PENDING.md for why per-category rates are left to
-- Ryan to set from the admin screen rather than guessed here.

BEGIN;

CREATE TABLE IF NOT EXISTS public.commission_rules (
    id                       SERIAL PRIMARY KEY,
    category_id              INTEGER REFERENCES public.categories(id),
    commission_rate          NUMERIC(6,4) NOT NULL CHECK (commission_rate >= 0 AND commission_rate < 1),
    fixed_processing_fee     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (fixed_processing_fee >= 0),
    tax_rate                 NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    commission_tax_included  BOOLEAN NOT NULL DEFAULT true,
    effective_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to             TIMESTAMPTZ,
    status                   VARCHAR(20) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'expired')),
    created_by               INTEGER REFERENCES public.users(id),
    updated_by               INTEGER REFERENCES public.users(id),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one currently-active rule per category. COALESCE folds every
-- NULL category_id onto the same key (-1, not a real category id) so the
-- single marketplace-wide default is covered by the same constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_rules_active_category
    ON public.commission_rules (COALESCE(category_id, -1))
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_commission_rules_category
    ON public.commission_rules (category_id);

COMMENT ON TABLE public.commission_rules IS
    'Versioned commission rates. An active row is never updated in place - it is closed out (status=''expired'', effective_to=now()) and a new active row is inserted, so a rate captured on a past order stays accurate. category_id NULL is the marketplace-wide default, applied when neither a product''s category nor any ancestor category has its own active rule.';

-- One conservative default so the engine works immediately. This is a
-- starting point, not a business decision baked in by this migration -
-- Ryan reviews and sets real per-category rates from the admin screen.
INSERT INTO public.commission_rules (category_id, commission_rate, fixed_processing_fee, tax_rate, commission_tax_included, status)
SELECT NULL, 0.15, 0, 0, true, 'active'
WHERE NOT EXISTS (
    SELECT 1 FROM public.commission_rules WHERE category_id IS NULL AND status = 'active'
);

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '061_commission_rules.sql',
    'Versioned commission_rules table (rate, fixed fee, tax per category; NULL category_id = marketplace-wide default), seeded with one 15% default rule.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
