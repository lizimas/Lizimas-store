-- 136_flash_sale_recurrence_and_share.sql
-- Flash sales (Ryan, Sept 2026):
--   recurs_every_hours - optional. When a running campaign's end time
--     passes it starts again automatically, this many hours after its last
--     start (e.g. 72 = a fresh 72-hour countdown every 72 hours).
--   share_token - a private link id. Only the admin panel shows the link;
--     anyone who opens it sees that one campaign.

BEGIN;

ALTER TABLE public.flash_sales
    ADD COLUMN IF NOT EXISTS recurs_every_hours INTEGER
        CHECK (recurs_every_hours IS NULL OR (recurs_every_hours >= 1 AND recurs_every_hours <= 8760)),
    ADD COLUMN IF NOT EXISTS share_token VARCHAR(32);

UPDATE public.flash_sales
   SET share_token = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 16)
 WHERE share_token IS NULL;

ALTER TABLE public.flash_sales ALTER COLUMN share_token SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16);
ALTER TABLE public.flash_sales ALTER COLUMN share_token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_flash_sales_share_token ON public.flash_sales (share_token);

INSERT INTO public.schema_migrations (filename, note)
VALUES ('136_flash_sale_recurrence_and_share.sql', 'flash_sales.recurs_every_hours + share_token (admin-only share link).')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
