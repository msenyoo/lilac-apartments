-- 045: Voluntary contribution drives — voluntary collections (memorial support, festival
-- collections, etc.) tracked separately from Maintenance and Corpus. See
-- docs/superpowers/specs/2026-08-19-contribution-drives-design.md

create table if not exists public.contribution_drives (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  status       text not null default 'open' check (status in ('open', 'closed')),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  closed_at    timestamptz,
  close_notes  text
);

alter table public.transactions
  add column if not exists drive_id    uuid references public.contribution_drives(id),
  add column if not exists resident_id uuid references public.residents(id);

create index if not exists idx_txns_drive_id on public.transactions(drive_id);

-- View: one row per drive, collected/disbursed/balance from transactions tagged to it.
-- category='Contribution' is not filtered on here — drive_id is the sole discriminator —
-- so this view stays correct even though category is a shared literal across all drives.
create or replace view public.v_contribution_tracker
with (security_invoker = true) as
select
  cd.id                                                                     as drive_id,
  cd.name,
  cd.description,
  cd.status,
  cd.created_at,
  cd.closed_at,
  coalesce(sum(t.amount) filter (where t.cr_dr = 'CR' and t.row_type != 'VOIDED'), 0) as collected,
  coalesce(sum(t.amount) filter (where t.cr_dr = 'DR' and t.row_type != 'VOIDED'), 0) as disbursed,
  coalesce(sum(t.amount) filter (where t.cr_dr = 'CR' and t.row_type != 'VOIDED'), 0)
    - coalesce(sum(t.amount) filter (where t.cr_dr = 'DR' and t.row_type != 'VOIDED'), 0) as balance,
  max(t.value_date) filter (where t.row_type != 'VOIDED')                   as last_activity
from public.contribution_drives cd
left join public.transactions t on t.drive_id = cd.id
group by cd.id, cd.name, cd.description, cd.status, cd.created_at, cd.closed_at;

-- RLS: mirrors corpus_plans (migrations 013 + 020) — read-all, admin-only write
alter table public.contribution_drives enable row level security;

drop policy if exists "contribution_drives_read" on public.contribution_drives;
create policy "contribution_drives_read" on public.contribution_drives
  for select to authenticated using (true);

drop policy if exists "contribution_drives_admin_write" on public.contribution_drives;
create policy "contribution_drives_admin_write" on public.contribution_drives
  for all to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');

-- Audit trigger (mirrors pattern from 012/016/032)
drop trigger if exists trg_audit_contribution_drives on public.contribution_drives;
create trigger trg_audit_contribution_drives
  after insert or update or delete on public.contribution_drives
  for each row execute function public.fn_audit_trigger();
