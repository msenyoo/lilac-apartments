-- 044: Drop period_from/period_to from expense_line_items.
--   Never used in any report calculation or date-range bucketing (only ever
--   shown as a cosmetic label, with expense_date/paid_date already the
--   fallback everywhere they appeared). paid_date (migration 033) already
--   plays the "date on this line item" role that pending_line_items.paid_date
--   plays on the pending-item side — no replacement needed.

ALTER TABLE public.expense_line_items
  DROP COLUMN IF EXISTS period_from,
  DROP COLUMN IF EXISTS period_to;
