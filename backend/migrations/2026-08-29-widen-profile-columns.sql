-- Widen the Step-2 answer columns.
--
-- "Current Hybrid Owner (HEV / PHEV)" is 33 characters and the column
-- was VARCHAR(32), so MySQL rejected the whole INSERT with "Data too
-- long for column 'ev_experience'". Every registration choosing that
-- option failed at the final submit, the record stayed PARTIAL, and no
-- confirmation was ever queued -- while the guest saw the success
-- screen, because the page confirms optimistically.
--
-- segment and drives could overflow the same way: both accept
-- "Other - " plus up to 60 typed characters (68 total) against
-- VARCHAR(48).
--
-- SQLite stores all of these as TEXT, which is why local testing never
-- saw it. Validation caps every one of these at 80 characters, so 96
-- leaves headroom without another round of this.
--
-- Run once, as an admin (the app user holds no ALTER grant by design):
--   sudo mysql xpeng_future_night < backend/migrations/2026-08-29-widen-profile-columns.sql

ALTER TABLE registrations
  MODIFY COLUMN age            VARCHAR(96) DEFAULT NULL,
  MODIFY COLUMN segment        VARCHAR(96) DEFAULT NULL,
  MODIFY COLUMN drives         VARCHAR(96) DEFAULT NULL,
  MODIFY COLUMN intent         VARCHAR(96) DEFAULT NULL,
  MODIFY COLUMN budget         VARCHAR(96) DEFAULT NULL,
  MODIFY COLUMN model_interest VARCHAR(96) DEFAULT NULL,
  MODIFY COLUMN ev_experience  VARCHAR(96) DEFAULT NULL;
