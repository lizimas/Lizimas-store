-- 105_prohibited_items.sql
-- Phase 8 - Prohibited Items (Ryan, Sept 2026). Admin-managed list of
-- banned keywords and/or entire banned categories, checked against every
-- product create/update (productController.js addProduct/updateProduct)
-- before it's allowed to save - see server/utils/prohibitedItems.js for
-- the matching logic.

BEGIN;

CREATE TABLE IF NOT EXISTS public.prohibited_items (
    id            SERIAL PRIMARY KEY,
    keyword       VARCHAR(200),
    category_id   INTEGER REFERENCES public.categories(id),
    reason        TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_by    INTEGER REFERENCES public.users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (keyword IS NOT NULL OR category_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_prohibited_items_active ON public.prohibited_items (is_active);
CREATE INDEX IF NOT EXISTS idx_prohibited_items_category ON public.prohibited_items (category_id) WHERE category_id IS NOT NULL;
-- A keyword ban shouldn't ever be added twice by accident - case-insensitive
-- so "Firearms" and "firearms" collide rather than silently coexisting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prohibited_items_keyword_lower
    ON public.prohibited_items (lower(keyword)) WHERE keyword IS NOT NULL;

COMMENT ON TABLE public.prohibited_items IS
    'Admin-managed keyword and/or category bans, checked against every product create/update before it can save. keyword matches against name/description/brand (word-boundary, case-insensitive); category_id bans an entire category outright. See server/utils/prohibitedItems.js.';

INSERT INTO public.schema_migrations (filename, note)
VALUES (
    '105_prohibited_items.sql',
    'Phase 8: prohibited_items - admin-managed keyword/category bans enforced at product create/update.'
)
ON CONFLICT (filename) DO NOTHING;

COMMIT;
