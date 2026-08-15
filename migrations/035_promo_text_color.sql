-- 035_promo_text_color.sql
-- Optional text colour for promotions. NULL means "work it out from the
-- background", which is the safe default: the swatch grid lets any tint be
-- chosen, so a fixed dark red would eventually land on a dark background.
-- A value here is an explicit override for brand colours.

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS text_color varchar(16);
