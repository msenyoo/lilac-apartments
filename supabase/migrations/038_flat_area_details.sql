-- 038: Flat area details (floor, carpet/plinth/common/saleable/P.O.T area, UDS)
-- Values come from the builder's area statement, collected from owners over time.
-- All nullable — flats start with these unfilled until the committee records them.

ALTER TABLE public.flats
  ADD COLUMN IF NOT EXISTS floor          text,
  ADD COLUMN IF NOT EXISTS carpet_area    numeric,
  ADD COLUMN IF NOT EXISTS plinth_area    numeric,
  ADD COLUMN IF NOT EXISTS common_area    numeric,
  ADD COLUMN IF NOT EXISTS saleable_area  numeric,
  ADD COLUMN IF NOT EXISTS pot_area       numeric,
  ADD COLUMN IF NOT EXISTS uds_total      numeric;
