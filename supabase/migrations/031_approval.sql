-- 031: Expense approval workflow infrastructure
-- Adds approval_status (pending|approved|rejected), approved_by (uuid FK), approved_at,
-- rejection_reason to the expenses table.
-- The old approved_by column was TEXT (free text). We replace it with a proper uuid FK
-- to auth.users so we can look up who approved and show their name.

-- Step 1: rename the old text column so we can reuse the name as uuid
ALTER TABLE public.expenses
  RENAME COLUMN approved_by TO approved_by_legacy;

-- Step 2: add new columns
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS approval_status   text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS rejection_reason  text;

-- Step 3: drop the now-redundant legacy column
-- (approved_at was already timestamptz and remains unchanged)
ALTER TABLE public.expenses DROP COLUMN IF EXISTS approved_by_legacy;

-- Step 4: index for pending queue lookups
CREATE INDEX IF NOT EXISTS idx_expenses_approval_status
  ON public.expenses(approval_status)
  WHERE approval_status = 'pending';

-- Step 5: comments
COMMENT ON COLUMN public.expenses.approval_status IS
  'pending = awaiting admin review; approved = cleared for payment totals; rejected = excluded';
COMMENT ON COLUMN public.expenses.approved_by IS
  'auth.users.id of the admin who approved/rejected this expense';
COMMENT ON COLUMN public.expenses.rejection_reason IS
  'Filled in when approval_status = ''rejected''';
