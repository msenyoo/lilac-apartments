-- Deposits (Fixed Deposits / term deposits) table
CREATE TABLE IF NOT EXISTS public.deposits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_no     text NOT NULL,
  bank           text NOT NULL,
  principal      integer NOT NULL,
  interest_rate  numeric(5,2) NOT NULL,
  opened_date    date NOT NULL,
  maturity_date  date NOT NULL,
  matured_date   date,
  maturity_amount integer,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','matured','closed')),
  source_type    text NOT NULL DEFAULT 'surplus'
                   CHECK (source_type IN ('surplus','corpus','other')),
  corpus_plan_id uuid REFERENCES public.corpus_plans(id),
  notes          text,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Link bank transactions to deposits (DR = FD opened, CR = FD matured)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS deposit_id uuid REFERENCES public.deposits(id);

-- Track partial/over-payment on expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('unpaid','partial','paid')),
  ADD COLUMN IF NOT EXISTS amount_paid integer;

-- RLS: read access for all authenticated users, write only for admin
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deposits_read" ON public.deposits
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "deposits_admin_write" ON public.deposits
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  );
