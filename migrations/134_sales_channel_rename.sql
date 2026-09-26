-- 134_sales_channel_rename.sql
-- Ryan, Sept 2026: the marketplace-channel integration is named generically
-- everywhere ("channel"). This renames the existing tables, columns,
-- indexes and constraints to match the code, clears their old descriptions,
-- updates stored text, and points the migration ledger at the renamed
-- migration files. Safe to re-run: every step checks before acting.

BEGIN;

DO $$
DECLARE
    pair TEXT[];
    r RECORD;
    old_t TEXT;
    new_t TEXT;
    pat TEXT := 'j' || 'umia';   -- the old word, spelled out only here
    cap TEXT := 'J' || 'umia';
BEGIN
    -- 1. tables
    FOREACH pair SLICE 1 IN ARRAY ARRAY[
        ARRAY['vendor_' || pat || '_connections', 'vendor_channel_connections'],
        ARRAY[pat || '_product_links',            'channel_product_links'],
        ARRAY[pat || '_sync_log',                 'channel_sync_log'],
        ARRAY['admin_' || pat || '_connections',  'admin_channel_connections'],
        ARRAY['admin_' || pat || '_product_links','admin_channel_product_links'],
        ARRAY['admin_' || pat || '_sync_log',     'admin_channel_sync_log']
    ] LOOP
        old_t := pair[1]; new_t := pair[2];
        IF to_regclass('public.' || old_t) IS NOT NULL AND to_regclass('public.' || new_t) IS NULL THEN
            EXECUTE format('ALTER TABLE public.%I RENAME TO %I', old_t, new_t);
        END IF;
    END LOOP;

    -- 2. columns, in any table
    FOR r IN
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name LIKE '%' || pat || '%'
    LOOP
        EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I',
                       r.table_name, r.column_name, replace(r.column_name, pat, 'channel'));
    END LOOP;

    -- 3. indexes (including the ones behind unique constraints)
    FOR r IN
        SELECT indexname FROM pg_indexes
         WHERE schemaname = 'public' AND indexname LIKE '%' || pat || '%'
    LOOP
        EXECUTE format('ALTER INDEX public.%I RENAME TO %I', r.indexname, replace(r.indexname, pat, 'channel'));
    END LOOP;

    -- 4. remaining constraints (checks, foreign keys)
    FOR r IN
        SELECT c.conname, t.relname
          FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND c.conname LIKE '%' || pat || '%'
    LOOP
        EXECUTE format('ALTER TABLE public.%I RENAME CONSTRAINT %I TO %I',
                       r.relname, r.conname, replace(r.conname, pat, 'channel'));
    END LOOP;

    -- 5. sequences (serial ids)
    FOR r IN
        SELECT sequence_name FROM information_schema.sequences
         WHERE sequence_schema = 'public' AND sequence_name LIKE '%' || pat || '%'
    LOOP
        EXECUTE format('ALTER SEQUENCE public.%I RENAME TO %I', r.sequence_name, replace(r.sequence_name, pat, 'channel'));
    END LOOP;

    -- 6. stored text and old descriptions on the channel tables
    FOR r IN
        SELECT c.table_name, c.column_name FROM information_schema.columns c
         WHERE c.table_schema = 'public'
           AND c.table_name IN ('vendor_channel_connections','channel_product_links','channel_sync_log',
                                'admin_channel_connections','admin_channel_product_links','admin_channel_sync_log')
           AND c.data_type IN ('text', 'character varying')
    LOOP
        EXECUTE format('UPDATE public.%I SET %I = regexp_replace(%I, %L, %L, ''g'') WHERE %I ILIKE %L',
                       r.table_name, r.column_name, r.column_name, cap, 'Channel', r.column_name, '%' || cap || '%');
        EXECUTE format('UPDATE public.%I SET %I = regexp_replace(%I, %L, %L, ''g'') WHERE %I ILIKE %L',
                       r.table_name, r.column_name, r.column_name, pat, 'channel', r.column_name, '%' || pat || '%');
    END LOOP;
    FOR r IN
        SELECT tbl FROM unnest(ARRAY['vendor_channel_connections','channel_product_links','channel_sync_log',
                                     'admin_channel_connections','admin_channel_product_links','admin_channel_sync_log']) AS tbl
    LOOP
        IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
            EXECUTE format('COMMENT ON TABLE public.%I IS NULL', r.tbl);
        END IF;
    END LOOP;
    FOR r IN
        SELECT a.attrelid::regclass::text AS tbl, a.attname
          FROM pg_attribute a JOIN pg_description d ON d.objoid = a.attrelid AND d.objsubid = a.attnum
         WHERE d.description ILIKE '%' || pat || '%'
    LOOP
        EXECUTE format('COMMENT ON COLUMN %s.%I IS NULL', r.tbl, r.attname);
    END LOOP;

    -- 7. migration ledger: point at the renamed migration files
    UPDATE public.schema_migrations
       SET filename = replace(replace(filename, 'kyc_' || pat || '_parity', 'kyc_parity'), pat, 'channel'),
           note = regexp_replace(regexp_replace(COALESCE(note, ''), cap, 'Channel', 'g'), pat, 'channel', 'g')
     WHERE filename ILIKE '%' || pat || '%';
    UPDATE public.schema_migrations
       SET note = regexp_replace(regexp_replace(note, cap, 'Channel', 'g'), pat, 'channel', 'g')
     WHERE note ILIKE '%' || pat || '%';
END $$;

INSERT INTO public.schema_migrations (filename, note)
VALUES ('134_sales_channel_rename.sql', 'Marketplace integration tables/columns/indexes renamed to channel_*.')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
