-- 048: expose close_notes on v_contribution_tracker so the Reopen dialog can show why a
-- drive was closed before someone reopens it.

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
  max(t.value_date) filter (where t.row_type != 'VOIDED')                   as last_activity,
  cd.close_notes
from public.contribution_drives cd
left join public.transactions t on t.drive_id = cd.id
group by cd.id, cd.name, cd.description, cd.status, cd.created_at, cd.closed_at, cd.close_notes;
