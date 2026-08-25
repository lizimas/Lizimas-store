-- 044a_rename_legacy_payments.sql
--
-- Moves the July payments table aside so 044_payments.sql can build the new
-- state-machine table cleanly.
--
-- Why rename rather than ALTER:
--   * Old rows have no `provider` and their statuses use a different vocabulary
--     ('verified' vs 'succeeded').
--   * Local order 5 has 9 concurrent pending rows, so the new
--     payments_one_live_attempt_per_order partial unique index cannot build
--     over the existing data. Those rows aren't corrupt — they're the honest
--     record of 9 RequestToPay attempts under a system with no concept of a
--     live attempt. They're only invalid under the new rules.
--   * A rename gives a hard boundary: the old controllers keep writing to
--     payments_legacy, the new module owns payments, and there is never a
--     moment where both touch the same rows.
--
-- Run BEFORE 044_payments.sql.

BEGIN;

DO $$
BEGIN
    -- Bail out cleanly if the legacy table was already moved.
    IF to_regclass('public.payments_legacy') IS NOT NULL THEN
        RAISE NOTICE 'payments_legacy already exists - nothing to do';
        RETURN;
    END IF;

    IF to_regclass('public.payments') IS NULL THEN
        RAISE NOTICE 'no payments table found - nothing to rename';
        RETURN;
    END IF;

    -- Refuse to rename the NEW table by mistake. If `payments` already has a
    -- `provider` column then 044 has run and this migration is being applied
    -- out of order. Renaming here would move the live table aside and take
    -- payments down.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'payments'
          AND column_name  = 'provider'
    ) THEN
        RAISE EXCEPTION
            'payments already has a provider column - 044 appears to have run. Refusing to rename.';
    END IF;

    ALTER TABLE public.payments RENAME TO payments_legacy;

    -- Postgres does not rename dependent objects automatically. Leaving a
    -- constraint called payments_pkey on a table called payments_legacy will
    -- confuse you in three months, and will collide in pg_dump output once
    -- 044 creates its own payments_pkey.
    ALTER TABLE public.payments_legacy
        RENAME CONSTRAINT payments_pkey TO payments_legacy_pkey;

    ALTER TABLE public.payments_legacy
        RENAME CONSTRAINT payments_order_id_fkey TO payments_legacy_order_id_fkey;

    -- The column default tracks the sequence by OID, so renaming the sequence
    -- keeps the default working; it just displays under the new name.
    IF to_regclass('public.payments_id_seq') IS NOT NULL THEN
        ALTER SEQUENCE public.payments_id_seq RENAME TO payments_legacy_id_seq;
    END IF;

    COMMENT ON TABLE public.payments_legacy IS
        'Pre-044 payment records written by paymentController.js and momoController.js. '
        'Read-only history after cutover. Do not drop: order 4 (local) holds a verified '
        'row and prod holds real customer attempts against orders 16,17,19,20,21.';

    RAISE NOTICE 'renamed payments -> payments_legacy';
END $$;

COMMIT;
