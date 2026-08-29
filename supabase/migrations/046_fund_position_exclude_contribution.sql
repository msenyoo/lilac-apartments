-- 046: v_fund_position was bucketing every non-corpus transaction into "Maintenance",
-- which silently folded Contribution-drive money (migration 045) into the reported
-- Maintenance cash position. Split it into its own "Contribution" fund bucket instead —
-- the Dashboard only reads the Maintenance/Corpus rows, so this excludes Contribution
-- money from both without any app-side change.

create or replace view public.v_fund_position
with (security_invoker = true) as
select
  case
    when corpus = 'YES' then 'Corpus'
    when category = 'Contribution' then 'Contribution'
    else 'Maintenance'
  end as fund,
  coalesce(sum(case when cr_dr = 'CR' then amount else 0 end), 0)::bigint as receipts,
  coalesce(sum(case when cr_dr = 'DR' then amount else 0 end), 0)::bigint as payments,
  coalesce(sum(case when cr_dr = 'CR' then amount else -amount end), 0)::bigint as balance
from public.transactions
where row_type != 'VOIDED'
group by
  case
    when corpus = 'YES' then 'Corpus'
    when category = 'Contribution' then 'Contribution'
    else 'Maintenance'
  end;
