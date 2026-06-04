-- 006: Expenses management — staff, vendors, day-book, reconciliation

-- 1. Staff master (security, sweepers, gardener, etc.)
CREATE TABLE IF NOT EXISTS public.staff (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text NOT NULL,
  role           text NOT NULL,         -- Security | Sweeper | Gardener | Plumber | Admin
  assigned_area  text,                  -- Block-A | Common | All
  phone          text,
  joined_date    date,
  left_date      date,                  -- NULL = still active
  notes          text,
  created_at     timestamptz DEFAULT now()
);

-- Staff salary history (rate changes tracked like maintenance_rate_history)
CREATE TABLE IF NOT EXISTS public.staff_salary_history (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id       uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  monthly_salary integer NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,                  -- NULL = current rate
  notes          text,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_salary_staff ON public.staff_salary_history(staff_id);

-- 2. Vendor / payee master
CREATE TABLE IF NOT EXISTS public.vendors (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text NOT NULL,
  type           text,                  -- Individual | Company | Agency
  phone          text,
  pan_number     text,
  notes          text,
  created_at     timestamptz DEFAULT now()
);

-- 3. Expense categories (configurable master list)
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text NOT NULL UNIQUE,
  budget_type    text NOT NULL DEFAULT 'Maintenance' CHECK (budget_type IN ('Maintenance', 'Corpus')),
  is_utility     boolean DEFAULT false, -- flags EB, sewage for unit-level tracking
  sort_order     integer DEFAULT 99,
  created_at     timestamptz DEFAULT now()
);

INSERT INTO public.expense_categories (name, budget_type, is_utility, sort_order) VALUES
  ('Salary',              'Maintenance', false,  1),
  ('EB (Electricity)',    'Maintenance', true,   2),
  ('Sewage Tanker',       'Maintenance', true,   3),
  ('Water',               'Maintenance', true,   4),
  ('Lift Maintenance',    'Maintenance', false,  5),
  ('Plumbing',            'Maintenance', false,  6),
  ('Electrical Work',     'Maintenance', false,  7),
  ('Cleaning Supplies',   'Maintenance', false,  8),
  ('Security',            'Maintenance', false,  9),
  ('Garden Maintenance',  'Maintenance', false, 10),
  ('Generator / DG Set',  'Maintenance', true,  11),
  ('Municipal Taxes',     'Maintenance', false, 12),
  ('Internet / Telecom',  'Maintenance', false, 13),
  ('Administrative',      'Maintenance', false, 14),
  ('Painting',            'Corpus',      false, 20),
  ('Civil Work',          'Corpus',      false, 21),
  ('Waterproofing',       'Corpus',      false, 22),
  ('Miscellaneous',       'Maintenance', false, 99)
ON CONFLICT (name) DO NOTHING;

-- 4. Voucher counter (thread-safe sequential numbering per fiscal year)
CREATE TABLE IF NOT EXISTS public.expense_voucher_counters (
  fiscal_year integer PRIMARY KEY,
  last_seq    integer NOT NULL DEFAULT 0
);

-- Auto-generate voucher number on insert
CREATE OR REPLACE FUNCTION public.generate_expense_voucher()
RETURNS TRIGGER AS $$
DECLARE
  fy       integer;
  next_seq integer;
BEGIN
  IF NEW.voucher_no IS NOT NULL THEN RETURN NEW; END IF;

  fy := CASE WHEN EXTRACT(MONTH FROM NEW.expense_date) >= 4
    THEN EXTRACT(YEAR FROM NEW.expense_date)::integer
    ELSE EXTRACT(YEAR FROM NEW.expense_date)::integer - 1
  END;

  INSERT INTO public.expense_voucher_counters (fiscal_year, last_seq)
  VALUES (fy, 1)
  ON CONFLICT (fiscal_year) DO UPDATE
    SET last_seq = public.expense_voucher_counters.last_seq + 1
  RETURNING last_seq INTO next_seq;

  NEW.voucher_no := 'EXP-' || fy || '-' || LPAD(next_seq::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Expenses header table (the actual bank transfer / cash payment)
CREATE TABLE IF NOT EXISTS public.expenses (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_date         date NOT NULL,
  description          text NOT NULL,
  -- Who received the money (intermediary or direct payee)
  payee_type           text NOT NULL CHECK (payee_type IN ('Staff','Vendor','Intermediary','Municipal','Other')),
  staff_id             uuid REFERENCES public.staff(id),
  vendor_id            uuid REFERENCES public.vendors(id),
  payee_name_raw       text,            -- fallback if not in master
  -- Payment details
  amount               integer NOT NULL CHECK (amount > 0),
  payment_mode         text NOT NULL CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque')),
  cheque_number        text,
  reference_no         text,            -- UPI ref, NEFT ref, etc.
  voucher_no           text UNIQUE,     -- auto: EXP-YYYY-NNNN
  -- Classification
  category_id          uuid REFERENCES public.expense_categories(id),
  corpus_plan_id       uuid REFERENCES public.corpus_plans(id), -- NULL = maintenance expense
  -- Bank reconciliation
  transaction_id       uuid REFERENCES public.transactions(id),
  reconciled_at        timestamptz,
  reconciliation_notes text,
  -- Approval
  approved_by          text,
  approved_at          timestamptz,
  -- Audit
  notes                text,
  created_at           timestamptz DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_date       ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category   ON public.expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor      ON public.expenses(vendor_id);
CREATE INDEX IF NOT EXISTS idx_expenses_txn         ON public.expenses(transaction_id);

CREATE TRIGGER trg_expense_voucher
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.generate_expense_voucher();

-- 6. Expense line items (the split/breakdown from receipts)
CREATE TABLE IF NOT EXISTS public.expense_line_items (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id      uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  -- Actual recipient
  payee_type      text NOT NULL CHECK (payee_type IN ('Staff','Vendor','Utility','Municipal','Other')),
  staff_id        uuid REFERENCES public.staff(id),
  vendor_id       uuid REFERENCES public.vendors(id),
  payee_name_raw  text,
  -- What for
  description     text NOT NULL,
  category_id     uuid REFERENCES public.expense_categories(id),
  -- Cost allocation
  cost_center     text NOT NULL,        -- Block-A..E | Common | Municipal | All | Flat-BF1
  -- Amount
  amount          integer NOT NULL CHECK (amount > 0),
  -- Utility detail (EB units, sewage volume, etc.)
  utility_units   numeric(10,2),        -- kWh for EB, KL for sewage, trips for tanker
  utility_rate    numeric(10,2),        -- rate per unit
  -- Billing period
  period_from     date,
  period_to       date,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_items_expense ON public.expense_line_items(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_center  ON public.expense_line_items(cost_center);

-- 7. Expense attachments (bill/receipt scans → Supabase Storage)
CREATE TABLE IF NOT EXISTS public.expense_attachments (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id  uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  file_url    text NOT NULL,
  file_size   integer,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_by uuid REFERENCES public.profiles(id)
);

-- 8. Recurring expense templates (lift AMC, security agency, etc.)
CREATE TABLE IF NOT EXISTS public.recurring_expense_templates (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  description  text,
  vendor_id    uuid REFERENCES public.vendors(id),
  category_id  uuid REFERENCES public.expense_categories(id),
  amount       integer NOT NULL,
  payment_mode text NOT NULL CHECK (payment_mode IN ('Cash','Online','Bank Transfer','Cheque')),
  frequency    text NOT NULL CHECK (frequency IN ('Monthly','Quarterly','Annual')),
  active       boolean DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

-- 9. Petty cash register
CREATE TABLE IF NOT EXISTS public.petty_cash_transactions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  txn_date        date NOT NULL,
  txn_type        text NOT NULL CHECK (txn_type IN ('Opening','Replenishment','Disbursement')),
  amount          integer NOT NULL,
  expense_id      uuid REFERENCES public.expenses(id),      -- linked if disbursement
  transaction_id  uuid REFERENCES public.transactions(id),  -- bank withdrawal for replenishment
  notes           text,
  created_at      timestamptz DEFAULT now()
);

-- 10. Link transactions table to expenses for reconciliation
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS expense_id uuid REFERENCES public.expenses(id);

CREATE INDEX IF NOT EXISTS idx_txn_expense ON public.transactions(expense_id);

-- 11. Convenience view: reconciliation status per expense
CREATE OR REPLACE VIEW public.v_expense_reconciliation AS
SELECT
  e.id,
  e.voucher_no,
  e.expense_date,
  e.description,
  e.amount,
  e.payment_mode,
  e.transaction_id,
  e.reconciled_at,
  CASE
    WHEN e.payment_mode = 'Cash'                THEN 'Cash'
    WHEN e.transaction_id IS NOT NULL            THEN 'Reconciled'
    ELSE                                              'Unreconciled'
  END AS reconciliation_status,
  v.name  AS vendor_name,
  ec.name AS category_name,
  cp.name AS corpus_plan_name
FROM public.expenses e
LEFT JOIN public.vendors            v  ON v.id  = e.vendor_id
LEFT JOIN public.expense_categories ec ON ec.id = e.category_id
LEFT JOIN public.corpus_plans       cp ON cp.id = e.corpus_plan_id
ORDER BY e.expense_date DESC;
