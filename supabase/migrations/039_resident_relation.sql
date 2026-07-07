-- 039: resident relation — who this person is relative to the tenancy.
-- type = Owner|Tenant stays the business-logic axis; relation is descriptive.
ALTER TABLE public.residents
  ADD COLUMN IF NOT EXISTS relation text NOT NULL DEFAULT 'Self'
  CHECK (relation IN ('Self','Co-owner','Spouse','Parent','Child','Guardian','Other'));
