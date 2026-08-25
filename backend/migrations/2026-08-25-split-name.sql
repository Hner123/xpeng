-- Split the stored name into first / last, keeping the combined column.
-- Run once, as an admin (the app user holds no ALTER grant by design):
--   sudo mysql xpeng_future_night < backend/migrations/2026-08-25-split-name.sql
--
-- Existing rows keep name_enc and get NULL for the two new columns;
-- the app treats NULL as "registered before the split" and falls back
-- to the combined name.

ALTER TABLE registrations
  ADD COLUMN first_name_enc VARBINARY(256) DEFAULT NULL AFTER name_enc,
  ADD COLUMN last_name_enc  VARBINARY(256) DEFAULT NULL AFTER first_name_enc;
