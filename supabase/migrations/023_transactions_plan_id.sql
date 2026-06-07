-- 023: Add nullable plan_id FK to transactions for corpus plan disambiguation

ALTER TABLE public.transactions
  ADD COLUMN plan_id uuid REFERENCES public.corpus_plans(id);
