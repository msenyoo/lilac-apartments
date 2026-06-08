-- Soft-delete / void support for expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS void_reason text;

-- Soft-deactivation for vendors (hide from dropdowns, preserve FK history)
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Soft-deactivation for expense categories
ALTER TABLE expense_categories
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
